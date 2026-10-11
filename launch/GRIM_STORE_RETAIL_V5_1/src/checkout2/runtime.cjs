const { allowedOrigin } = require('./allowed-origin.cjs');
'use strict';
const express=require('express');
const {createShippingQuoteFlow,cartKey}=require('./shipping-quote-flow.cjs');
const {ShippingError}=require('./shipbubble-quotes.cjs');
const {createProviderSetup}=require('./shipbubble-setup.cjs');
const {createSenderValidator}=require('./shipbubble-validate.cjs');
const {CheckoutError}=require('./checkout-core.cjs');
function createRuntime({config,supabase,env=process.env}) {
  async function rows(table,columns) {
    if(!supabase) throw new Error('Database unavailable');
    const {data,error}=await supabase.from(table).select(columns);
    if(error || !Array.isArray(data)) throw new Error('Database read unavailable');
    return data;
  }
  const catalog=async()=>{
    const result=Object.create(null);
    for(const p of await rows('products','id,name,color,price,active')) {
      const price=String(p.price), parts=price.split('.');
      const priceKobo=/^\d+(\.\d{1,2})?$/.test(price) ? Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0')) : NaN;
      result[String(p.id)]={active:p.active===true || Number(p.active)===1,priceKobo,name:p.name,color:p.color};
    }
    return result;
  };
  async function customer(req) {
    const user=req.session?.user;
    if(!user?.email || !supabase) return null;
    const {data,error}=await supabase.from('customers').select('id,email,name,first_name,last_name,phone,account_status')
      .eq('email',String(user.email).trim().toLowerCase()).maybeSingle();
    if(error) throw error;
    if(!data || ['disabled','deactivated','suspended','deleted'].includes(String(data.account_status||'').toLowerCase())) return null;
    return {...data,firstName:data.first_name,lastName:data.last_name};
  }
  async function measurementLoader(items) {
    const records=await rows('grim2_product_shipping','product_id,weight_kg,dimensions');
    const metrics=Object.create(null);
    for(const r of records) metrics[r.product_id]={weightKg:Number(r.weight_kg),dimension:r.dimensions};
    if(items.length===1 && items[0].quantity===1) metrics.outerPackage=metrics[items[0].productId]?.dimension;
    else {
      const {data,error}=await supabase.from('grim2_package_shipping').select('dimensions').eq('cart_key',cartKey(items)).maybeSingle();
      if(error) throw error;
      metrics.outerPackage=data?.dimensions;
    }
    return metrics;
  }
  let shippingQuoteFlow=null,shippingBlocker=null;
  // This admin-only read endpoint is independent of the Checkout 2.0 launch
  // flags and schema, so the merchant can find genuine provider codes safely.
  const shipbubbleKey = config.production ? env.SHIPBUBBLE_API_KEY : env.GRIM_CHECKOUT2_SHIPBUBBLE_API_KEY;
  try {
    // A production-only key is never inherited by Preview. Quote APIs have no booking method.
    shippingQuoteFlow=createShippingQuoteFlow({catalog,measurementLoader,
      apiKey:shipbubbleKey,
      senderAddressCode:env.GRIM_SHIPPING_SENDER_ADDRESS_CODE,categoryId:env.GRIM_SHIPPING_CATEGORY_ID,
      signingSecret:env.GRIM_SHIPPING_SIGNING_SECRET || env.SESSION_SECRET});
  } catch(e) {shippingBlocker=e.code || 'SHIPPING_NOT_CONFIGURED';}
  const admin=express.Router();
  admin.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.session?.admin!==true) return res.status(401).json({error:'ADMIN_REQUIRED'});
    if(req.method!=='GET' && !allowedOrigin(req.headers.origin, config)) return res.status(403).json({error:'ORIGIN_REJECTED'});
    if(!supabase && req.path !== '/shipping/provider-setup') return res.status(503).json({error:'DATABASE_UNAVAILABLE'});
    next();
  });
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.code||'ADMIN_UNAVAILABLE',message:(e instanceof CheckoutError || e.name === 'ShipbubbleSetupError' || e.name === 'SenderValidationError') ? e.message : 'Shipping configuration could not be saved or loaded.'});}};
  const dimension=x=>{
    if(!x || ['length','width','height'].some(k=>typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<=0||x[k]>1000))
      throw new CheckoutError('INVALID_MEASUREMENTS','Enter measured positive package dimensions in centimetres.');
    return {length:x.length,width:x.width,height:x.height};
  };
  // Manual-quote requests: separate tables, no payment initiation and no notifications.
  const quoteRequests=env.GRIM_HYBRID_QUOTE_REQUESTS_ENABLED==='true' && supabase
    ? require('./hybrid-quote-requests.cjs').createService({db:supabase,catalog}) : null;
  admin.get('/shipping/hybrid/requests',wrap(async(_req,res)=>{
    if(!quoteRequests)throw new CheckoutError('FEATURE_DISABLED','Manual quote requests are disabled.',503);
    res.json({requests:await quoteRequests.listAdmin()});
  }));
  admin.post('/shipping/hybrid/requests/:id/quote',wrap(async(req,res)=>{
    if(!quoteRequests)throw new CheckoutError('FEATURE_DISABLED','Manual quote requests are disabled.',503);
    res.json(await quoteRequests.setQuote({id:req.params.id,feeKobo:req.body?.feeKobo}));
  }));
  // Separate, opt-in hybrid rate manager. Existing courier integrations stay untouched.
  admin.get('/shipping/hybrid/rates',wrap(async(_req,res)=>{
    const {fetchRates}=require('./hybrid-delivery.cjs');
    res.json({rates:await fetchRates(supabase)});
  }));
  admin.post('/shipping/hybrid/rates',wrap(async(req,res)=>{
    const {parseRate}=require('./hybrid-delivery.cjs');
    const input=parseRate(req.body);
    const {data,error}=await supabase.from('grim2_hybrid_rates').insert(input).select('id').single();
    if(error)throw new CheckoutError('RATE_SAVE_FAILED','Unable to save this delivery rate.',503);
    res.status(201).json({saved:true,id:data.id,enabled:input.enabled});
  }));
  // Edit existing zone rates without deleting records. Setting enabled=false is reversible.
  admin.patch('/shipping/hybrid/rates/:id',wrap(async(req,res)=>{
    const {parseRate}=require('./hybrid-delivery.cjs');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id))
      throw new CheckoutError('INVALID_RATE','Invalid delivery rate identifier.',400);
    const input=parseRate(req.body);
    const {data,error}=await supabase.from('grim2_hybrid_rates').update(input).eq('id',req.params.id).select('id').maybeSingle();
    if(error)throw new CheckoutError('RATE_SAVE_FAILED','Unable to update this delivery rate.',503);
    if(!data)throw new CheckoutError('RATE_NOT_FOUND','Delivery rate not found.',404);
    res.json({saved:true,id:data.id,enabled:input.enabled});
  }));
  admin.get('/shipping/provider-setup',wrap(async(_req,res)=>{
    const provider = createProviderSetup({apiKey:shipbubbleKey});
    const result = await provider();
    res.json({...result, senderCodeConfigured:!!env.GRIM_SHIPPING_SENDER_ADDRESS_CODE,
      categoryConfigured:!!env.GRIM_SHIPPING_CATEGORY_ID, quoteConfigured:!!shippingQuoteFlow});
  }));
  // An explicit, authenticated admin action. Never run at startup or on page load.
  // Shipbubble may debit a validation credit or charge for a successful validation.
  admin.post('/shipping/validate-sender',wrap(async(req,res)=>{
    if(req.body?.confirmValidation!==true)
      throw new CheckoutError('VALIDATION_CONFIRMATION_REQUIRED','Confirm potential Shipbubble validation charges before submitting.',400);
    const validator=createSenderValidator({apiKey:shipbubbleKey});
    const validated=await validator(req.body?.sender);
    res.json({validated:true,...validated,configuredInVercel:!!env.GRIM_SHIPPING_SENDER_ADDRESS_CODE});
  }));
  admin.get('/shipping',wrap(async(_req,res)=>res.json({products:await rows('products','id,name'),
    productMeasurements:await rows('grim2_product_shipping','product_id,weight_kg,dimensions'),
    packages:await rows('grim2_package_shipping','cart_key,dimensions'),shippingBlocker})));
  admin.put('/shipping/product/:id',wrap(async(req,res)=>{
    if(!/^\d+$/.test(req.params.id)) throw new CheckoutError('INVALID_PRODUCT','Choose a product.');
    const {data:product,error:lookupError}=await supabase.from('products').select('id').eq('id',req.params.id).maybeSingle();
    if(lookupError||!product) throw new CheckoutError('INVALID_PRODUCT','Product was not found.');
    const weight=req.body?.weightKg;
    if(typeof weight!=='number'||!Number.isFinite(weight)||weight<=0||weight>1000) throw new CheckoutError('INVALID_MEASUREMENTS','Enter a measured weight in kilograms.');
    const {error}=await supabase.from('grim2_product_shipping').upsert({product_id:req.params.id,weight_kg:weight,dimensions:dimension(req.body?.dimensions),updated_at:new Date().toISOString()});
    if(error) throw error;res.json({saved:true});
  }));
  admin.put('/shipping/package',wrap(async(req,res)=>{
    const key=req.body?.cartKey;
    if(typeof key!=='string'||key.length>3000||!/^\d+:(S|M|L|XL|XXL):([1-9]|10)(\|\d+:(S|M|L|XL|XXL):([1-9]|10))*$/.test(key)) throw new CheckoutError('INVALID_PACKAGE','Enter the exact bag key shown by checkout.');
    const {error}=await supabase.from('grim2_package_shipping').upsert({cart_key:key,dimensions:dimension(req.body?.dimensions),updated_at:new Date().toISOString()});
    if(error) throw error;res.json({saved:true});
  }));
  admin.get('/orders/:reference',wrap(async(req,res)=>{
    if(!/^GRIM2-[0-9a-f-]{36}$/.test(req.params.reference)) throw new CheckoutError('INVALID_REFERENCE','Invalid checkout reference.');
    const {data,error}=await supabase.from('grim2_attempts').select('reference,status,order_id,quote,payment_evidence,created_at,paid_at').eq('reference',req.params.reference).maybeSingle();
    if(error) throw error;res.json(data);
  }));
  return {catalog,sessionUser:customer,shippingQuoteFlow,shippingBlocker,admin,quoteRequests};
}
module.exports={createRuntime};

'use strict';
const express=require('express');
const {createShippingQuoteFlow,cartKey}=require('./shipping-quote-flow.cjs');
const {ShippingError}=require('./shipbubble-quotes.cjs');
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
  try {
    // A production-only key is never inherited by Preview. Quote APIs have no booking method.
    shippingQuoteFlow=createShippingQuoteFlow({catalog,measurementLoader,
      apiKey:config.production ? env.SHIPBUBBLE_API_KEY : env.GRIM_CHECKOUT2_SHIPBUBBLE_API_KEY,
      senderAddressCode:env.GRIM_SHIPPING_SENDER_ADDRESS_CODE,categoryId:env.GRIM_SHIPPING_CATEGORY_ID,
      signingSecret:env.GRIM_SHIPPING_SIGNING_SECRET || env.SESSION_SECRET});
  } catch(e) {shippingBlocker=e.code || 'SHIPPING_NOT_CONFIGURED';}
  const admin=express.Router();
  admin.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.session?.admin!==true) return res.status(401).json({error:'ADMIN_REQUIRED'});
    if(req.method!=='GET' && req.headers.origin!==config.base) return res.status(403).json({error:'ORIGIN_REJECTED'});
    if(!supabase) return res.status(503).json({error:'DATABASE_UNAVAILABLE'});
    next();
  });
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.code||'ADMIN_UNAVAILABLE',message:e instanceof CheckoutError ? e.message : 'Shipping configuration could not be saved or loaded.'});}};
  const dimension=x=>{
    if(!x || ['length','width','height'].some(k=>typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<=0||x[k]>1000))
      throw new CheckoutError('INVALID_MEASUREMENTS','Enter measured positive package dimensions in centimetres.');
    return {length:x.length,width:x.width,height:x.height};
  };
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
  return {catalog,sessionUser:customer,shippingQuoteFlow,shippingBlocker,admin};
}
module.exports={createRuntime};

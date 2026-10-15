'use strict';
const crypto = require('node:crypto');
const {estimate} = require('./hybrid-delivery.cjs');
const {buildQuote,address,CheckoutError} = require('./checkout-core.cjs');

function createHybridFlow({catalog,db,signingSecret,courierFlow,now=Date.now}) {
  if (typeof signingSecret !== 'string' || signingSecret.length < 32) throw Error('Shipping signing secret required');
  const rates = estimate({catalog,db});
  const mac = body => crypto.createHmac('sha256',signingSecret).update(`GRIM-ZONE-v1:${body}`).digest('base64url');
  async function prepare({customer,lines,destination}) {
    if (!customer?.id) throw new CheckoutError('SIGN_IN_REQUIRED','Sign in to continue.',401);
    const dest=address(destination);
    const priced=buildQuote({lines,catalog:await catalog(lines),shippingKobo:0});
    const rate=await rates({lines,destination:dest});
    const binding=crypto.createHash('sha256').update(JSON.stringify({customer:String(customer.id),dest,items:priced.items.slice().sort((a,b)=>`${a.productId}:${a.size}`.localeCompare(`${b.productId}:${b.size}`)),rate})).digest('hex');
    return {priced,rate,binding};
  }
  async function quote(input) {
    const p=await prepare(input);
    if (p.rate.kind !== 'INSTANT') {
      if (courierFlow && input.destination?.country === 'NG') {
        try { return await courierFlow.quote(input); } catch (e) {
          if (!['PACKAGE_MEASUREMENTS_REQUIRED','NO_COURIERS','SHIPPING_NOT_CONFIGURED'].includes(e.code)) throw e;
        }
      }
      return {...p.rate,couriers:[],manualQuoteRequired:true,message:'Request a delivery quotation. Payment becomes available after GRIM confirms delivery.'};
    }
    const body=Buffer.from(JSON.stringify({binding:p.binding,customer:String(input.customer.id),exp:now()+600000})).toString('base64url');
    return {currency:'NGN',subtotalKobo:p.priced.subtotalKobo,expiresInSeconds:600,couriers:[{
      courierId:`zone:${p.rate.rateId}`,serviceCode:'zone',name:'GRIM delivery',eta:'Confirmed by GRIM',
      amountKobo:p.rate.feeKobo,totalKobo:p.rate.totalKobo,selectionToken:`ZONE.${body}.${mac(body)}`
    }]};
  }
  async function resolve(input) {
    if (!String(input.selectionToken||'').startsWith('ZONE.')) {
      if (courierFlow) return courierFlow.resolve(input);
      throw new CheckoutError('SHIPPING_REQUIRED','Choose a delivery rate.',409);
    }
    const token=String(input.selectionToken);
    const [,body,sig,...extra]=token.split('.');
    if (token.length>2000 || extra.length || !body || !/^[A-Za-z0-9_-]{43}$/.test(sig||'') ||
        !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(mac(body))))
      throw new CheckoutError('INVALID_SHIPPING_TOKEN','Refresh your delivery options.',409);
    let claim;try {claim=JSON.parse(Buffer.from(body,'base64url').toString());} catch {throw new CheckoutError('INVALID_SHIPPING_TOKEN','Refresh your delivery options.',409);}
    const p=await prepare(input);
    if (p.rate.kind!=='INSTANT' || claim.customer!==String(input.customer.id) || claim.binding!==p.binding || !Number.isSafeInteger(claim.exp) || now()>=claim.exp)
      throw new CheckoutError('SHIPPING_QUOTE_EXPIRED_OR_CHANGED','Delivery details or prices changed. Refresh your delivery options.',409);
    return {shippingKobo:p.rate.feeKobo,quote:{...p.priced,shippingKobo:p.rate.feeKobo,totalKobo:p.rate.totalKobo,deliveryMethod:'zone',rateId:p.rate.rateId,shippingExpiresAt:claim.exp}};
  }
  return {quote,resolve};
}
module.exports={createHybridFlow};

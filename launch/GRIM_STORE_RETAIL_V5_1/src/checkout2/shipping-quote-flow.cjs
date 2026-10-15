'use strict';
const crypto = require('node:crypto');
const { buildQuote, address, CheckoutError } = require('./checkout-core.cjs');
const { createShippingSelection } = require('./shipping-selection.cjs');
const { createShipbubbleQuotes, ShippingError } = require('./shipbubble-quotes.cjs');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cartKey = items => items.map(i=>`${i.productId}:${i.size}:${i.quantity}`).sort().join('|');
function createShippingQuoteFlow({catalog, apiKey, senderAddressCode, categoryId, signingSecret,
  packageMetrics, measurementLoader, fetchImpl, clock=()=>new Date()}) {
  const sb=createShipbubbleQuotes({apiKey,senderAddressCode,categoryId,fetchImpl});
  const tokens=createShippingSelection({secret:signingSecret,now:()=>clock().getTime()});
  async function prepared(customer,lines,destination) {
    if (!customer?.id || !customer.email) throw new CheckoutError('SIGN_IN_REQUIRED','Sign in to continue.',401);
    const dest=address(destination);
    if(dest.country!=='NG') throw new ShippingError('UNSUPPORTED_DESTINATION','Shipping is currently within Nigeria only');
    const priced=buildQuote({lines,catalog:await catalog(lines),shippingKobo:0});
    // Production supplies measurements from the protected admin tables. No guessed package sizes.
    const metrics=measurementLoader ? await measurementLoader(priced.items) : packageMetrics;
    const items=priced.items.map(i=>{
      const m=metrics?.[i.productId];
      if(!m || !Number.isFinite(m.weightKg) || m.weightKg<=0)
        throw new ShippingError('PACKAGE_MEASUREMENTS_REQUIRED',`Packed weight is missing for ${i.name}. Payment is unavailable until GRIM measures it.`);
      return {name:i.name,description:[i.name,i.color,i.size].filter(Boolean).join(' / '),
        quantity:i.quantity,unit_weight:m.weightKg,unit_amount:i.unitKobo/100};
    });
    const dimension=metrics?.outerPackage;
    if(!dimension || ['length','width','height'].some(k=>!Number.isFinite(dimension[k]) || dimension[k]<=0))
      throw new ShippingError('PACKAGE_MEASUREMENTS_REQUIRED',`Measured outer package dimensions are missing for this bag (${cartKey(priced.items)}).`);
    const binding=hash({items:priced.items.slice().sort((a,b)=>`${a.productId}:${a.size}`.localeCompare(`${b.productId}:${b.size}`)),
      dest,packageItems:items,dimension,senderAddressCode,categoryId,contact:{name:customer.name,phone:customer.phone,email:customer.email}});
    return {priced,dest,items,dimension,binding};
  }
  const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
  async function quote({customer,lines,destination}) {
    const p=await prepared(customer,lines,destination);
    await sb.validateSender();
    const destinationCode=await sb.validateDestination({name:customer.name,email:customer.email,phone:customer.phone,
      address:[p.dest.address,p.dest.apartment,p.dest.city,p.dest.state,p.dest.postal,'Nigeria'].filter(Boolean).join(', ')});
    const rates=await sb.fetchRates({destinationCode,pickupDate:date(),items:p.items,dimension:p.dimension});
    return {currency:'NGN',subtotalKobo:p.priced.subtotalKobo,expiresInSeconds:600,
      couriers:rates.couriers.map(c=>({...c,totalKobo:p.priced.subtotalKobo+c.amountKobo,
        selectionToken:tokens.sign({customerId:customer.id,destinationCode,cartFingerprint:p.binding,requestToken:rates.requestToken,courier:c})}))};
  }
  async function resolve({customer,lines,destination,selectionToken}) {
    const p=await prepared(customer,lines,destination);
    let claim;
    try {claim=tokens.verify(selectionToken,{customerId:customer.id,cartFingerprint:p.binding});}
    catch {throw new CheckoutError('SHIPPING_QUOTE_EXPIRED_OR_CHANGED','Refresh your delivery options before paying.',409);}
    await sb.validateSender();
    // Obtain a new provider quote before starting payment. Address codes returned by validation
    // need not be stable across separate validations; bind the complete normalized address instead.
    const rates=await sb.fetchRates({destinationCode:claim.destinationCode,pickupDate:date(),items:p.items,dimension:p.dimension});
    const c=rates.couriers.find(x=>String(x.courierId)===claim.courierId && x.serviceCode===claim.serviceCode);
    if(!c || c.amountKobo!==claim.amountKobo)
      throw new CheckoutError('SHIPPING_QUOTE_EXPIRED_OR_CHANGED','Your courier or delivery price changed. Refresh delivery options.',409);
    const courier={id:String(c.courierId),name:c.name,eta:c.eta,serviceCode:c.serviceCode,
      requestToken:rates.requestToken,destinationCode:claim.destinationCode,senderAddressCode:Number(senderAddressCode),amountKobo:c.amountKobo,
      packageItems:p.items,packageDimension:p.dimension,pickupDate:date()};
    return {shippingKobo:c.amountKobo,courier,quote:{...p.priced,shippingKobo:c.amountKobo,
      totalKobo:p.priced.subtotalKobo+c.amountKobo,courier,shippingExpiresAt:claim.exp}};
  }
  return {quote,resolve};
}
module.exports={createShippingQuoteFlow,cartKey};

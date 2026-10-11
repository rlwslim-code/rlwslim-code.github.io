'use strict';
const {quote}=require('./hybrid-rates.cjs');
const {buildQuote,address,CheckoutError}=require('./checkout-core.cjs');
const err=(code,msg,status=400)=>new CheckoutError(code,msg,status);
async function fetchRates(db){
 const {data,error}=await db.from('grim2_hybrid_rates').select('id,country,state,city,fee_kobo,max_weight_grams,enabled');
 if(error)throw err('HYBRID_RATES_UNAVAILABLE','Hybrid rates have not been configured.',503);
 return (data||[]).map(r=>({id:r.id,country:r.country,state:r.state,city:r.city,feeKobo:Number(r.fee_kobo),maxWeightGrams:Number(r.max_weight_grams),enabled:r.enabled}));
}
function estimate({catalog,db}){return async({lines,destination})=>{
 if(!db)throw err('DATABASE_UNAVAILABLE','Delivery estimates are unavailable.',503);
 const dest=address(destination);
 const priced=buildQuote({lines,catalog:await catalog(lines),shippingKobo:0});
 const rates=await fetchRates(db);
 // No guessed parcel weight: configured rate only applies if all items have measured weights.
 const ids=priced.items.map(x=>String(x.productId));
 const {data:measurements,error}=await db.from('grim2_product_shipping').select('product_id,weight_kg').in('product_id',ids);
 if(error)throw err('MEASUREMENTS_UNAVAILABLE','Delivery measurements are unavailable.',503);
 const weights=new Map((measurements||[]).map(x=>[String(x.product_id),Number(x.weight_kg)]));
 const unknown=priced.items.some(i=>!Number.isFinite(weights.get(String(i.productId)))||weights.get(String(i.productId))<=0);
 if(unknown)return {kind:'MANUAL_QUOTE_REQUIRED',currency:'NGN',subtotalKobo:priced.subtotalKobo,reason:'UNMEASURED_PRODUCTS'};
 const grams=Math.ceil(priced.items.reduce((sum,i)=>sum+weights.get(String(i.productId))*i.quantity*1000,0));
 return quote({country:dest.country,state:dest.state,city:dest.city,subtotalKobo:priced.subtotalKobo,weightGrams:grams},rates);
 };}
function parseRate(body){
 const country=String(body?.country||'').trim().toUpperCase();
 if(!/^[A-Z]{2}$/.test(country))throw err('INVALID_COUNTRY','Enter a two-letter country code.');
 const state=String(body?.state||'').trim(),city=String(body?.city||'').trim();
 if(state.length>100||city.length>100)throw err('INVALID_LOCATION','Location is too long.');
 const fee=body?.feeKobo,weight=body?.maxWeightGrams;
 if(!Number.isSafeInteger(fee)||fee<0||fee>1000000000)throw err('INVALID_FEE','Enter a valid rate in kobo.');
 if(!Number.isSafeInteger(weight)||weight<=0||weight>1000000)throw err('INVALID_WEIGHT','Enter maximum weight in grams.');
 return {country,state,city,fee_kobo:fee,max_weight_grams:weight,enabled:body.enabled===true};
}
module.exports={estimate,parseRate,fetchRates};

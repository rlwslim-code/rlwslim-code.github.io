'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {createShippingQuoteFlow}=require('../../src/checkout2/shipping-quote-flow.cjs');
const customer={id:'cust-1',email:'customer@example.com',name:'Example Customer',phone:'08012345678'};
const lines=[{productId:'1',quantity:1,size:'M'}];
const destination={country:'NG',address:'Sample street',city:'Ado Ekiti',state:'Ekiti'};
const defaults={apiKey:'sb_sandbox_SAMPLE',senderAddressCode:123,categoryId:789,signingSecret:'x'.repeat(48),
 catalog:async()=>({'1':{name:'Hoodie',active:true,priceKobo:2800000}}),
 packageMetrics:{'1':{weightKg:0.6},outerPackage:{length:30,width:25,height:10}},
 clock:()=>new Date('2026-10-09T09:00:00Z'),
 fetchImpl:async(url)=>({ok:true,json:async()=>({status:'success',data:url.endsWith('/address/validate')?
 {address_code:234,country_code:'NG'}:
 url.endsWith('/address/123') ? {country_code:'NG',state:'Ekiti',city:'Oye-Ekiti'} : {request_token:'quote-ref',couriers:[{courier_id:7,courier_name:'Courier',service_code:'pickup',rate_card_currency:'NGN',service_type:'pickup',rate_card_amount:4200}]}})})};
test('quotes paid delivery options with total and opaque signed selection',async()=>{
 const r=await createShippingQuoteFlow(defaults).quote({customer,lines,destination});
 assert.equal(r.subtotalKobo,2800000);assert.equal(r.couriers[0].amountKobo,420000);
 assert.equal(r.couriers[0].totalKobo,3220000);
 assert.match(r.couriers[0].selectionToken,/^[\w-]+\.[\w-]+$/);
});
test('refuses missing package weights, never guesses shipping charge',async()=>{
 await assert.rejects(createShippingQuoteFlow({...defaults,packageMetrics:{outerPackage:{length:30,width:20,height:10}}}).quote({customer,lines,destination}),{code:'PACKAGE_MEASUREMENTS_REQUIRED'});
});
test('refuses non-Nigeria delivery before provider call',async()=>{
 await assert.rejects(createShippingQuoteFlow(defaults).quote({customer,lines,destination:{...destination,country:'US'}}),{code:'UNSUPPORTED_DESTINATION'});
});

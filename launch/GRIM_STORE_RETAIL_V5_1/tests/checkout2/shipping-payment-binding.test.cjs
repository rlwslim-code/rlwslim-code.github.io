'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');
const goodAddress={country:'NG',address:'Example street',city:'Oye',state:'Ekiti'};
const line=[{productId:'1',quantity:1,size:'M'}];
const catalog=async()=>({'1':{active:true,priceKobo:2800000,name:'Hoodie'}});
const original={customerId:'customer-1',email:'test@example.com',key:'0123456789abcdef',method:'card',lines:line,shipping:goodAddress,contact:{firstName:'Test',lastName:'Customer',phone:'08012345678'}};
function make(resolver){
let created=null;
const store={byKey:async()=>null,create:async x=>{created=x;return {...x,status:'new',customer_id:x.customerId,quote:x.quote}},claim:async()=>true,initialized:async()=>{},flag:async()=>{}};
const engine=createEngine({catalog,store,provider:{initialize:async()=>({authorization_url:'https://checkout.paystack.com/test'})},callbackBase:'https://example.com',mode:'live',shippingRequired:true,shippingResolver:resolver});
return {engine,created:()=>created};
}
test('live checkout refuses payment without courier selection',async()=>{
 const {engine,created}=make(async()=>({shippingKobo:20000}));
 await assert.rejects(engine.start({...original,expectedTotalKobo:2800000}),{code:'SHIPPING_REQUIRED'});
 assert.equal(created(),null);
});
test('verified delivery is included in Paystack amount and persisted quotation',async()=>{
 const {engine,created}=make(async()=>({shippingKobo:420000,courier:{id:'7',requestToken:'req'}}));
 const r=await engine.start({...original,shippingSelectionToken:'signed-quote',expectedTotalKobo:3220000});
 assert.equal(r.quote.totalKobo,3220000);
 assert.equal(r.quote.shippingKobo,420000);
 assert.equal(created().quote.courier.id,'7');
});
test('browser cannot claim a lower total than selected courier quote',async()=>{
 const {engine,created}=make(async()=>({shippingKobo:420000,courier:{id:'7'}}));
 await assert.rejects(engine.start({...original,shippingSelectionToken:'signed-quote',expectedTotalKobo:2800000}),{code:'PRICE_CHANGED'});
 assert.equal(created(),null);
});
test('unavailable courier is fail closed',async()=>{
 const {engine,created}=make(async()=>{throw Error('provider down')});
 await assert.rejects(engine.start({...original,shippingSelectionToken:'signed-quote',expectedTotalKobo:3220000}));
 assert.equal(created(),null);
});

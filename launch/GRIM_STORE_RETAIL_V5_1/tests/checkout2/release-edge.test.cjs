'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,input}=require('./fixture.cjs');
const {createShippingQuoteFlow}=require('../../src/checkout2/shipping-quote-flow.cjs');
const {verifyProvider}=require('../../src/checkout2/checkout-core.cjs');
test('exact charged total still rejects a conflicting original requested amount',()=>{
 assert.throws(()=>verifyProvider({expected:{reference:'ref',email:'a@example.test',totalKobo:2800000},provider:{reference:'ref',domain:'test',status:'success',currency:'NGN',id:1,amount:2800000,requested_amount:2700000,customer:{email:'a@example.test'}}}),{code:'PAYMENT_MISMATCH'});
});
test('expired and changed parcel quotes cannot start a payment',async()=>{
 let time=Date.now();const metrics={'1':{weightKg:0.5},outerPackage:{length:30,width:20,height:10}};
 const flow=createShippingQuoteFlow({catalog:async()=>({'1':{active:true,priceKobo:2800000,name:'Fixture'}}),apiKey:'fixture-key',senderAddressCode:123,categoryId:789,signingSecret:'x'.repeat(48),packageMetrics:metrics,clock:()=>new Date(time),fetchImpl:async u=>({ok:true,json:async()=>({status:'success',data:u.endsWith('/address/123')?{country_code:'NG',state:'Ekiti',city:'Oye-Ekiti'}:u.endsWith('/address/validate')?{country_code:'NG',address_code:234}:{request_token:'quote',couriers:[{courier_id:7,courier_name:'Fixture',service_code:'fixture',service_type:'pickup',rate_card_currency:'NGN',rate_card_amount:4200}]}})})});
 const args={customer:{id:'fixture',email:'fixture@example.test',name:'Fixture Customer',phone:'08000000000'},lines:input.lines,destination:input.shipping};
 const q=await flow.quote(args),selected={...args,selectionToken:q.couriers[0].selectionToken};
 metrics['1'].weightKg=0.8;await assert.rejects(flow.resolve(selected),{code:'SHIPPING_QUOTE_EXPIRED_OR_CHANGED'});metrics['1'].weightKg=0.5;
 time+=600001;await assert.rejects(flow.resolve(selected),{code:'SHIPPING_QUOTE_EXPIRED_OR_CHANGED'});
});
test('unpaid wallet attempt can be closed without debit; stale key cannot reopen it',async()=>{
 const f=await fixture();try {
 await f.db.query('insert into grim2_wallet_accounts(customer_id,balance_kobo) values ($1,100)',[input.customerId]);
 await assert.rejects(f.engine.start({...input,method:'wallet'}),{code:'WALLET_UNAVAILABLE'});
 const row=(await f.store.pending(input.customerId))[0];const result=await f.engine.closeWallet({reference:row.reference,customerId:input.customerId});assert.equal(result.status,'cancelled');
 await assert.rejects(f.engine.start({...input,method:'wallet'}),{code:'CHECKOUT_CANCELLED'});
 assert.equal((await f.store.wallet(input.customerId)).balanceKobo,100);assert.equal((await f.store.pending(input.customerId)).length,0);
 }finally{await f.close();}
});

test('maintenance pause blocks new payment creation while retaining confirmed-card recovery',async()=>{
 const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');const f=await fixture();try{
 const old=await f.engine.start(input);const paused=createEngine({catalog:f.catalog,store:f.store,provider:f.provider,callbackBase:'https://fixture.test',acceptNewOrders:false});
 await assert.rejects(paused.start({...input,key:'different_checkout_key001'}),{code:'ORDERING_PAUSED'});
 assert.equal((await paused.confirm({reference:old.reference,customerId:input.customerId})).status,'paid');
 }finally{await f.close();}
});

test('server Paystack verification preserves unsigned 64-bit transaction IDs exactly',async()=>{
 const {createPaystack}=require('../../src/checkout2/adapters.cjs');
 const p=createPaystack('sk_test_fixture',async()=>({ok:true,text:async()=>'{"status":true,"data":{"id":18446744073709551615,"status":"success"}}'}));
 assert.equal((await p.verify('fixture-reference')).id,'18446744073709551615');
});

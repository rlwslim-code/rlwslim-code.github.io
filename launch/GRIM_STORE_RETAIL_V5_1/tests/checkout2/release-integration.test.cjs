'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {releaseFixture}=require('./release-fixture.cjs');
const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');
const {createShippingQuoteFlow}=require('../../src/checkout2/shipping-quote-flow.cjs');
const {verifyProvider}=require('../../src/checkout2/checkout-core.cjs');
const lines=[{productId:'1',size:'M',quantity:1}],destination={country:'NG',address:'12 Fixture Road',city:'Oye-Ekiti',state:'Ekiti'};
const catalog=async()=>({'1':{active:true,name:'Hoodie',color:'Obsidian',priceKobo:2800000}});
function shipmentOptions(overrides={}) {
 let price=4200, sender={country_code:'NG',state:'Ekiti',city:'Oye-Ekiti'},count=0;
 const options={catalog,apiKey:'fixture-shipping-key',senderAddressCode:123,categoryId:789,signingSecret:'x'.repeat(48),
 packageMetrics:{'1':{weightKg:0.6},outerPackage:{length:30,width:25,height:10}},
 fetchImpl:async(url,o)=>{count++;if(url.endsWith('/address/123'))return {ok:true,json:async()=>({status:'success',data:sender})};
 if(url.endsWith('/address/validate'))return {ok:true,json:async()=>({status:'success',data:{address_code:234,country_code:'NG'}})};
 const body=JSON.parse(o.body);assert.equal(body.sender_address_code,123);assert.equal(body.reciever_address_code,234);assert.equal(body.service_type,'pickup');assert.equal(body.package_items[0].description,'Hoodie / Obsidian / M');
 return {ok:true,json:async()=>({status:'success',data:{request_token:'provider-'+count,couriers:[{courier_id:7,courier_name:'Fixture Courier',service_code:'fixture',rate_card_currency:'NGN',rate_card_amount:price,service_type:'pickup'}]}})};},...overrides};
 return {flow:createShippingQuoteFlow(options),price:x=>price=x,sender:x=>sender=x};
}
const customer=id=>({id,email:'release@example.test',name:'Release Customer',phone:'+2348000000000'});
const request=(id,key,method,token)=>({customerId:id,email:'release@example.test',key,method,lines,shipping:destination,billing:destination,contact:{firstName:'Release',lastName:'Customer',phone:'+2348000000000'},shippingSelectionToken:token,expectedTotalKobo:3220000});
test('integrated shipping, production wallet RPC model, order, receipt and customer linkage are atomic under retries',async()=>{
 const f=await releaseFixture();try {
 const s=shipmentOptions(),c=customer(f.customerId),q=await s.flow.quote({customer:c,lines,destination});
 const engine=createEngine({catalog,store:f.store,provider:{},callbackBase:'https://fixture.test',mode:'live',shippingRequired:true,shippingResolver:s.flow.resolve});
 const results=await Promise.all(Array.from({length:12},()=>engine.start(request(f.customerId,'wallet_checkout_key001','wallet',q.couriers[0].selectionToken))));
 assert.ok(results.every(x=>x.status==='paid'));assert.equal(new Set(results.map(x=>x.orderId)).size,1);
 assert.equal((await f.store.wallet(f.customerId)).balanceKobo,6780000);
 const orders=(await f.db.query("select * from orders where payment_status='paid'")).rows;
 assert.equal(orders.length,1);assert.equal(orders[0].customer_id,f.customerId);assert.equal(Number(orders[0].total),32200);assert.equal(Number(orders[0].total_minor),3220000);
 assert.equal((await f.db.query('select count(*)::int n from wallet_transactions')).rows[0].n,1);
 const receipt=(await f.db.query('select * from grim2_receipts')).rows[0];assert.equal(receipt.quote.courier.name,'Fixture Courier');assert.equal(receipt.quote.shippingKobo,420000);
 assert.equal((await f.db.query("select count(*)::int n from orders where payment_reference='historical-sentinel'")).rows[0].n,1);
 }finally{await f.close();}
});
test('order recording failure rolls back production wallet RPC model, ledger and receipt',async()=>{
 const f=await releaseFixture();try {
 const ref='GRIM2-11111111-1111-4111-8111-111111111111';await f.store.create({reference:ref,customerId:f.customerId,email:'release@example.test',key:'wallet_rollback_key001',method:'wallet',quote:{currency:'NGN',totalKobo:100000,items:[{productId:'1',name:'Hoodie',unitKobo:100000,quantity:1,size:'M'}]},shipping:destination,billing:destination,contact:{firstName:'Release',lastName:'Customer',phone:'08000000000'}});
 await f.db.exec("create function fail_receipt() returns trigger language plpgsql as $$begin raise exception 'fixture outage';end;$$;create trigger fixture_failure before insert on grim2_receipts for each row execute function fail_receipt();");
 await assert.rejects(f.store.completeWallet(ref));assert.equal((await f.store.wallet(f.customerId)).balanceKobo,10000000);
 assert.equal((await f.db.query('select count(*)::int n from wallet_transactions')).rows[0].n,0);assert.equal((await f.db.query("select count(*)::int n from orders where payment_reference=$1",[ref])).rows[0].n,0);
 await f.db.exec('drop trigger fixture_failure on grim2_receipts');assert.equal((await f.store.completeWallet(ref)).status,'paid');
 }finally{await f.close();}
});
test('verified NGN 28,527.92 charge records NGN 28,000 order and separate NGN 527.92 fee',async()=>{
 const f=await releaseFixture();try {
 const ref='GRIM2-22222222-2222-4222-8222-222222222222';await f.store.create({reference:ref,customerId:f.customerId,email:'release@example.test',key:'card_fee_checkout001',method:'card',quote:{currency:'NGN',totalKobo:2800000,items:[{productId:'1',name:'Hoodie',unitKobo:2800000,quantity:1,size:'M'}]},shipping:destination,billing:destination,contact:{firstName:'Release',lastName:'Customer',phone:'08000000000'}});
 const verified=verifyProvider({expected:{reference:ref,email:'release@example.test',totalKobo:2800000},mode:'live',provider:{id:'12345678901234567890',domain:'live',status:'success',reference:ref,amount:2852792,requested_amount:2800000,fees:52792,currency:'NGN',customer:{email:'release@example.test'}}});
 const r=await f.store.complete({reference:ref,providerId:verified.providerId,evidence:verified.evidence});assert.equal(r.status,'paid');assert.equal(r.payment_evidence.processingFeeKobo,52792);assert.equal(r.payment_evidence.chargedAmountKobo,2852792);
 assert.equal(Number((await f.db.query("select total from orders where payment_reference=$1",[ref])).rows[0].total),28000);
 await f.store.complete({reference:ref,providerId:verified.providerId,evidence:verified.evidence});assert.equal((await f.db.query('select count(*)::int n from grim2_receipts')).rows[0].n,1);
 }finally{await f.close();}
});
test('current courier rate, contact, full address and measured parcel are rebound before payment',async()=>{
 const s=shipmentOptions(),c=customer('fixture'),q=await s.flow.quote({customer:c,lines,destination}),args={customer:c,lines,destination,selectionToken:q.couriers[0].selectionToken};
 assert.equal((await s.flow.resolve(args)).shippingKobo,420000);
 for(const changed of [{customer:{...c,id:'other'}},{destination:{...destination,apartment:'Different apartment'}},{customer:{...c,phone:'+2348111111111'}},{lines:[{...lines[0],quantity:2}]}])await assert.rejects(s.flow.resolve({...args,...changed}));
 s.price(5000);await assert.rejects(s.flow.resolve(args),{code:'SHIPPING_QUOTE_EXPIRED_OR_CHANGED'});
 s.price(4200);s.sender({country_code:'NG',city:'Lagos',state:'Lagos'});await assert.rejects(s.flow.resolve(args),{code:'INVALID_ORIGIN'});
});
test('wallet RPC cannot reuse a transaction from another order',async()=>{
 const f=await releaseFixture();try {
 const ref='GRIM2-33333333-3333-4333-8333-333333333333';await f.store.create({reference:ref,customerId:f.customerId,email:'release@example.test',key:'wallet_crossorder_001',method:'wallet',quote:{currency:'NGN',totalKobo:100000,items:[{productId:'1',name:'Hoodie',unitKobo:100000,quantity:1,size:'M'}]},shipping:destination,billing:destination,contact:{firstName:'Release',lastName:'Customer',phone:'08000000000'}});
 await f.db.exec(`insert into wallet_transactions(id,customer_id,currency,amount_minor,transaction_type,order_id,idempotency_key,status,balance_before_minor,balance_after_minor) values('44444444-4444-4444-8444-444444444444','${f.customerId}','NGN',100000,'debit','unrelated-order','unrelated-key','completed',10000000,9900000);create or replace function grim_wallet_debit(p_customer_id uuid,p_currency varchar,p_amount_minor bigint,p_order_id text,p_description text,p_idempotency_key text) returns uuid language sql as $$select '44444444-4444-4444-8444-444444444444'::uuid;$$;`);
 await assert.rejects(f.store.completeWallet(ref));assert.equal((await f.store.wallet(f.customerId)).balanceKobo,10000000);assert.equal((await f.db.query('select count(*)::int n from grim2_receipts')).rows[0].n,0);
 }finally{await f.close();}
});

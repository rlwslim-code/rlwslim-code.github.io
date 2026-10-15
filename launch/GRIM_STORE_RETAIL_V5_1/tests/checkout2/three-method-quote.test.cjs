'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');
const {previewConfig}=require('../../src/checkout2/preview-config.cjs');
const id='d591c149-8257-438f-9e40-c23658e0fa0c';
const ref='GRIM2-12345678-1234-1234-1234-123456789abc';
const origin='https://www.grimwear.store';
function harness(method='card', extra={}) {
  let nInit=0,nWallet=0,nClaim=0,nComplete=0;
  const row={reference:ref,customer_id:'owner-1',email:'owner@grim.test',method:method==='wallet'?'wallet':'card',status:'created',
    quote:{currency:'NGN',totalKobo:150000,shippingKobo:100000,subtotalKobo:50000,
      manualQuoteId:id,paystackChannel:method==='bank_transfer'?'bank_transfer':'card',
      shippingExpiresAt:Date.now()+86400000},...extra};
  const charges=[];
  const store={
    startManualQuote:async()=>({...row}),
    claim:async()=>{nClaim++; if(row.status!=='created')return false;row.status='initializing';return true;},
    initialized:async(_ref,url)=>{row.status='pending';row.authorization_url=url;},
    get:async()=>({...row}),
    completeWallet:async()=>{nWallet++;row.status='paid';row.order_id='order-1';return {...row};},
    complete:async()=>{nComplete++;row.status='paid';row.order_id='order-1';return {...row};}
  };
  const provider={initialize:async input=>{nInit++;charges.push(input);return {authorization_url:'https://checkout.paystack.com/ownerquote'}},verify:async()=>({status:'success',reference:ref,amount:150000,requested_amount:150000,fees:0,domain:'live',currency:'NGN',id:12345,customer:{email:'owner@grim.test'},channel:method==='wallet'?'card':method})};
  const engine=createEngine({catalog:async()=>({}),store,provider,callbackBase:origin,mode:'live',walletEnabled:true});
  return {engine,row,charges,provider,store,counts:()=>({nInit,nWallet,nClaim,nComplete})};
}
const launch=(h,method,extra={})=>h.engine.startManualQuote({quoteId:id,customerId:'owner-1',email:'owner@grim.test',method,bankTransferEnabled:true,walletCheckoutEnabled:true,...extra});
test('payment channel toggles are disabled by default',()=>{
 const x=previewConfig({VERCEL_ENV:'production'});
 assert.equal(x.bankTransferEnabled,false);assert.equal(x.quoteWalletEnabled,false);
});
test('card initializes only card and exact quoted amount',async()=>{
 const h=harness('card');const r=await launch(h,'card');
 assert.equal(r.status,'pending');assert.equal(h.counts().nWallet,0);
 assert.deepEqual(h.charges[0].channels,['card']);
 assert.equal(h.charges[0].amount,150000);
 assert.equal(h.charges[0].callback_url,origin+'/delivery-request.html?reference='+ref);
 assert.equal(h.charges[0].currency,'NGN');
});
test('bank transfer initializes only transfer and exact quoted amount',async()=>{
 const h=harness('bank_transfer');const r=await launch(h,'bank_transfer');
 assert.equal(r.status,'pending');assert.deepEqual(h.charges[0].channels,['bank_transfer']);
 assert.equal(h.charges[0].amount,150000);assert.equal(h.counts().nWallet,0);
});
test('wallet uses wallet-only path, no Paystack, once for retry with already-paid attempt',async()=>{
 const h=harness('wallet');const r=await launch(h,'wallet');
 assert.equal(r.status,'paid');assert.equal(h.counts().nWallet,1);assert.equal(h.counts().nInit,0);
 const repeated=await launch(h,'wallet');assert.equal(repeated.status,'paid');assert.equal(h.counts().nWallet,1);
});
test('method cannot switch an existing reference',async()=>{
 const h=harness('card');await assert.rejects(launch(h,'wallet'),{code:'METHOD_LOCKED'});
 assert.equal(h.counts().nWallet,0);
 const t=harness('bank_transfer');await assert.rejects(launch(t,'card'),{code:'METHOD_LOCKED'});
 assert.equal(t.counts().nInit,0);
});
test('bank transfer and manual wallet require independent explicit flags',async()=>{
 const h=harness('wallet');await assert.rejects(launch(h,'wallet',{walletCheckoutEnabled:false}),{code:'WALLET_DISABLED'});
 assert.equal(h.counts().nWallet,0);
 const t=harness('bank_transfer');await assert.rejects(launch(t,'bank_transfer',{bankTransferEnabled:false}),{code:'TRANSFER_DISABLED'});
 assert.equal(t.counts().nInit,0);
});
test('expired confirmed quote blocks bank transfer initialization and wallet debit',async()=>{
 for(const method of ['card','bank_transfer','wallet']){
   const h=harness(method);h.row.quote.shippingExpiresAt=Date.now()-500;
   await assert.rejects(launch(h,method),{code:'QUOTE_EXPIRED'});
   assert.equal(h.counts().nInit,0);assert.equal(h.counts().nWallet,0);
 }
});
test('card retry returns the first authorization instead of initializing again',async()=>{
 const h=harness('card');await launch(h,'card');const r=await launch(h,'card');
 assert.ok(r.authorizationUrl.startsWith('https://checkout.paystack.com/'));
 assert.equal(h.counts().nInit,1);
});
test('existing initializing attempt is never reinitialized',async()=>{
 const h=harness('card',{status:'initialization_unknown'});
 const r=await launch(h,'card');assert.equal(r.status,'initialization_unknown');
 assert.equal(h.counts().nInit,0);
});
test('wrong owner cannot use another customer quotation attempt',async()=>{
 const h=harness('card',{customer_id:'another-customer'});
 await assert.rejects(launch(h,'card'),{code:'PAYMENT_MISMATCH'});
 assert.equal(h.counts().nInit,0);
});
test('invalid method rejected before writing a payment attempt',async()=>{
 const h=harness('card');await assert.rejects(launch(h,'cash'),{code:'INVALID_METHOD'});
 assert.equal(h.counts().nWallet,0);assert.equal(h.counts().nInit,0);
});

test('verified Paystack transfer records one completed order through existing verified finish path',async()=>{
 const h=harness('bank_transfer');await launch(h,'bank_transfer');
 const done=await h.engine.reconcile(ref,'owner-1');
 assert.equal(done.status,'paid');assert.equal(h.counts().nComplete,1);
 assert.equal(h.counts().nWallet,0);
});
test('Paystack verified channel mismatch blocks order completion',async()=>{
 const h=harness('bank_transfer');
 h.provider.verify=async()=>({status:'success',reference:ref,amount:150000,requested_amount:150000,fees:0,domain:'live',currency:'NGN',id:12345,customer:{email:'owner@grim.test'},channel:'card'});
 await assert.rejects(h.engine.reconcile(ref,'owner-1'),{code:'PAYMENT_CHANNEL_MISMATCH'});
 assert.equal(h.counts().nComplete,0);
});
test('Paystack amount mismatch blocks paid order recording',async()=>{
 const h=harness('card');
 h.provider.verify=async()=>({status:'success',reference:ref,amount:149900,requested_amount:149900,fees:0,domain:'live',currency:'NGN',id:12345,customer:{email:'owner@grim.test'},channel:'card'});
 await assert.rejects(h.engine.reconcile(ref,'owner-1'),{code:'PAYMENT_MISMATCH'});
 assert.equal(h.counts().nComplete,0);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../../src/checkout2/grim-checkout-v2.cjs');
const {previewConfig}=require('../../src/checkout2/preview-config.cjs');
test('manual quote payments are off by default',()=>{
 const c=previewConfig({VERCEL_ENV:'production'});assert.equal(c.quotePaymentsEnabled,false);
});
test('a fixed confirmed quote initializes exact Paystack amount and recovers without second charge',async()=>{
 const ref='GRIM2-12345678-1234-1234-1234-123456789abc';
 let row={reference:ref,customer_id:'customer-1',email:'test@example.com',method:'card',status:'created',quote:{currency:'NGN',totalKobo:150000}};
 let initializations=0;
 const store={startManualQuote:async()=>row,claim:async()=>{row={...row,status:'initializing'};return true},initialized:async(_,url)=>{row={...row,status:'pending',authorization_url:url}},get:async()=>row};
 const provider={initialize:async(p)=>{initializations++;assert.equal(p.amount,150000);assert.equal(p.callback_url,`https://www.grimwear.store/delivery-request.html?reference=${ref}`);return {authorization_url:'https://checkout.paystack.com/example'}}};
 const e=createEngine({catalog:async()=>({}),store,provider,callbackBase:'https://www.grimwear.store',mode:'live'});
 const a=await e.startManualQuote({quoteId:'some-id',customerId:'customer-1',email:'test@example.com'});
 assert.equal(a.status,'pending');
 const b=await e.startManualQuote({quoteId:'some-id',customerId:'customer-1',email:'test@example.com'});
 assert.equal(b.authorizationUrl,a.authorizationUrl);assert.equal(initializations,1);
});
test('an initializing payment cannot be initialized twice',async()=>{
 let called=0;const ref='GRIM2-12345678-1234-1234-1234-123456789abc';
 const row={reference:ref,customer_id:'c',method:'card',email:'u@example.com',status:'initialization_unknown',quote:{totalKobo:150000}};
 const e=createEngine({catalog:async()=>({}),store:{startManualQuote:async()=>row},provider:{initialize:async()=>{called++}},callbackBase:'https://www.grimwear.store',mode:'live'});
 const result=await e.startManualQuote({quoteId:'id',customerId:'c',email:'u@example.com'});
 assert.equal(result.status,'initialization_unknown');assert.equal(called,0);
});

'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const {previewConfig} = require('../../src/checkout2/preview-config.cjs');
const {createEngine} = require('../../src/checkout2/grim-checkout-v2.cjs');
const goodId = 'd591c149-8257-438f-9e40-c23658e0fa0c';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ref = 'GRIM2-12345678-1234-1234-1234-123456789abc';
const configEnv = {
  VERCEL_ENV: 'production', GRIM_CHECKOUT2_LIVE_ENABLED: 'true',
  GRIM_CHECKOUT2_PROD_DB_CONFIRMED: 'true', GRIM_CHECKOUT2_LIVE_PAYSTACK_SECRET_KEY: 'sk_live_TestOnlyNotARealKey',
  SUPABASE_URL:'https://example.supabase.co', SUPABASE_SECRET_KEY:'example-fake',
  GRIM_CHECKOUT2_PUBLIC_ORIGIN:'https://www.grimwear.store', SESSION_SECRET:'z'.repeat(40),
  GRIM_QUOTE_LIVE_PAYMENTS_ENABLED:'true', GRIM_CHECKOUT2_ACCEPT_NEW_ORDERS:'true'
};
function fakeRouter() {
  const get = new Map(), post = new Map();
  return {get: (key, handler) => get.set(key, handler), post:(key,handler) => post.set(key,handler),use:()=>{},routes:{get,post}};
}
function installRouter({configuration, requests, provider, store}) {
  const original = Module._load;
  let r;
  try {
    Module._load = function(name, parent, isMain) {
      if(name==='express') return {Router:()=>{r=fakeRouter();return r}};
      return original.apply(this,arguments);
    };
    const routeFile = path.resolve(__dirname, '../../src/checkout2/routes.cjs');
    delete require.cache[routeFile];
    const {createRoutes} = require(routeFile);
    createRoutes({config:configuration, catalog:async()=>({}), sessionUser:async()=>({id:'customer-1',email:'buyer@example.com'}),
      quoteRequests:{listCustomer:async()=>requests}, provider, store});
  } finally { Module._load=original; }
  return r;
}
async function invoke(handler, body={}){
  const res={statusCode:200, result:null, status(value){this.statusCode=value;return this},json(value){this.result=value;return this}};
  await handler({checkoutCustomer:{id:'customer-1',email:'buyer@example.com'},body},res);
  return res;
}
const quote = id => ({id,status:'QUOTE_READY',paymentStatus:'not_started',totalKobo:150000,subtotalKobo:50000});

test('missing or malformed merchant quote allowlist fails closed',()=>{
  assert.equal(previewConfig(configEnv).quoteTestId, null);
  assert.equal(previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:'bad-id'}).quoteTestId,null);
  assert.equal(previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId}).quoteTestId,goodId);
});
test('quote list enables payment for only allowed, ready, unpaid quotation',async()=>{
  const config=previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId});
  assert.equal(config.ready,true);
  const routes=installRouter({configuration:config,requests:[quote(goodId),quote(otherId),{...quote(goodId),id:goodId.toUpperCase(),paymentStatus:'paid'}],
    provider:{},store:{health:async()=>true}});
  const res=await invoke(routes.routes.get.get('/shipping/hybrid/requests'));
  assert.equal(res.statusCode,200);
  assert.equal(res.result.paymentEnabled,false);
  assert.deepEqual(res.result.requests.map(q=>q.paymentEnabled),[true,false,false]);
});
test('payments blocked for unapproved quote UUID before Paystack initialization',async()=>{
  let calls=0;
  const config=previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId});
  const routes=installRouter({configuration:config,requests:[quote(goodId)],provider:{initialize:async()=>{calls++;}},store:{}});
  const res=await invoke(routes.routes.post.get('/shipping/hybrid/pay'),{quoteId:otherId});
  assert.equal(res.statusCode,403);
  assert.equal(res.result.error,'TEST_QUOTE_ONLY');
  assert.equal(calls,0);
});
test('allowed quotation initializes precisely 150000 kobo once',async()=>{
  let calls=0, row={reference:ref,customer_id:'customer-1',email:'buyer@example.com',method:'card',status:'created',quote:{currency:'NGN',totalKobo:150000}};
  const config=previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId});
  const store={
    startManualQuote:async()=>row,
    claim:async()=>{row={...row,status:'initializing'};return true;},
    initialized:async(_,url)=>{row={...row,status:'pending',authorization_url:url}},
    get:async()=>row
  };
  const provider={initialize:async payload=>{calls++;assert.equal(payload.amount,150000);return {authorization_url:'https://checkout.paystack.com/fake-for-test-only'}}};
  const routes=installRouter({configuration:config,requests:[quote(goodId)],store,provider});
  const handler=routes.routes.post.get('/shipping/hybrid/pay');
  const res1=await invoke(handler,{quoteId:goodId});
  assert.equal(res1.statusCode,200);assert.equal(res1.result.status,'pending');
  const res2=await invoke(handler,{quoteId:goodId});
  assert.equal(res2.statusCode,200);assert.equal(res2.result.authorizationUrl,res1.result.authorizationUrl);assert.equal(calls,1);
});
test('even approved quotation stays off while order switch is false',async()=>{
  const config=previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId,GRIM_CHECKOUT2_ACCEPT_NEW_ORDERS:'false'});
  const routes=installRouter({configuration:config,requests:[quote(goodId)],store:{},provider:{}});
  const listing=await invoke(routes.routes.get.get('/shipping/hybrid/requests'));
  assert.equal(listing.result.requests[0].paymentEnabled,false);
  const pay=await invoke(routes.routes.post.get('/shipping/hybrid/pay'),{quoteId:goodId});
  assert.equal(pay.statusCode,503);assert.equal(pay.result.error,'PAYMENTS_LOCKED');
});

test('ordinary checkout stays blocked during controlled merchant quote test',async()=>{
  const config=previewConfig({...configEnv,GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID:goodId});
  let called=0;
  const routes=installRouter({configuration:config,requests:[],provider:{initialize:async()=>called++},store:{}});
  const res=await invoke(routes.routes.post.get('/start'),{lines:[{productId:'30',quantity:1,size:'M'}]});
  assert.equal(res.statusCode,403);
  assert.equal(res.result.error,'CONTROLLED_QUOTE_TEST_ONLY');
  assert.equal(called,0);
});

test('success verification checks amount, identity and reference before recording once',async()=>{
  let completes=0;
  let row={reference:ref,customer_id:'customer-1',email:'buyer@example.com',method:'card',status:'pending',quote:{currency:'NGN',totalKobo:150000}};
  const store={get:async()=>row,complete:async({reference,providerId,evidence})=>{
    completes++;assert.equal(reference,ref);assert.equal(providerId,'12345678909876543');
    assert.equal(evidence.chargedAmountKobo,150000);
    row={...row,status:'paid',provider_id:providerId,order_id:'987'};return row;
  }};
  const provider={verify:async()=>({reference:ref,domain:'live',status:'success',currency:'NGN',amount:150000,
    requested_amount:150000,fees:0,id:'12345678909876543',customer:{email:'buyer@example.com'}})};
  const engine=createEngine({catalog:async()=>({}),store,provider,callbackBase:'https://www.grimwear.store',mode:'live'});
  const first=await engine.confirm({reference:ref,customerId:'customer-1'});
  assert.equal(first.status,'paid');
  const repeat=await engine.confirm({reference:ref,customerId:'customer-1'});
  assert.equal(repeat.status,'paid');assert.equal(completes,1);
});

test('wrong charge amount is rejected without calling order completion',async()=>{
  const row={reference:ref,customer_id:'customer-1',email:'buyer@example.com',method:'card',status:'pending',quote:{currency:'NGN',totalKobo:150000}};
  let completes=0;
  const engine=createEngine({catalog:async()=>({}),store:{get:async()=>row,complete:async()=>{completes++}},
    provider:{verify:async()=>({reference:ref,domain:'live',status:'success',currency:'NGN',amount:50000,
      requested_amount:50000,fees:0,id:'1234',customer:{email:'buyer@example.com'}})},
    callbackBase:'https://www.grimwear.store',mode:'live'});
  await assert.rejects(()=>engine.confirm({reference:ref,customerId:'customer-1'}), e=>e.code==='PAYMENT_MISMATCH');
  assert.equal(completes,0);
});

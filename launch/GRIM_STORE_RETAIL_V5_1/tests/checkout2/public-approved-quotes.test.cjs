'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const {previewConfig} = require('../../src/checkout2/preview-config.cjs');
const {createSupabaseStore} = require('../../src/checkout2/adapters.cjs');

// Routes use a minimal HTTP router shim here so the unit test does not need
// npm install / a live database, and cannot initiate an external payment.
function prepareRoutes(config, {requests, user={id:'customer-1',email:'customer@example.com'}, payments=null, initializations=null}={}) {
  const handlers=new Map(), middleware=[];
  const router={
    use(fn){middleware.push(fn);},
    get(path,fn){handlers.set('GET '+path,fn);},
    post(path,fn){handlers.set('POST '+path,fn);}
  };
  const load=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='express')return {Router:()=>router};
    return load.apply(this,arguments);
  };
  const store={
    health:async()=>true,
    startManualQuote:async input=>{
      payments?.push(input);
      return {reference:'GRIM2-12345678-1234-1234-1234-123456789abc',customer_id:user.id,
        email:user.email,method:'card',status:'created',quote:{totalKobo:100000,manualQuoteId:input.quoteId,shippingExpiresAt:Date.now()+3600000}};
    },
    claim:async()=>true,
    initialized:async()=>{},
  };
  try {
    delete require.cache[require.resolve('../../src/checkout2/routes.cjs')];
    const {createRoutes}=require('../../src/checkout2/routes.cjs');
    createRoutes({config,catalog:async()=>[],store,
      provider:{initialize:async input=>{initializations?.push(input);return {authorization_url:'https://checkout.paystack.com/mock'};},verify:async()=>{}},
      quoteRequests:{listCustomer:async()=>requests},sessionUser:async()=>user});
  }finally{Module._load=load;}
  async function invoke(method,path,body={}){
    const fn=handlers.get(method+' '+path);
    assert.ok(fn,'route '+path+' exists');
    const req={method,path,body,headers:{origin:'https://www.grimwear.store'},session:{user}};
    let output;
    const res={set(){return this;},status(code){this.statusCode=code;return this;},json(payload){output={code:this.statusCode||200,payload};return this;}};
    for(const middlewareFn of middleware){
      await new Promise((resolve,reject)=>{
        try{Promise.resolve(middlewareFn(req,res,resolve)).catch(reject);}catch(err){reject(err);}
      });
    }
    await fn(req,res);
    return output;
  }
  return {invoke};
}
const QUOTE='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const later=new Date(Date.now()+3600000).toISOString();
const earlier=new Date(Date.now()-3600000).toISOString();
const base={enabled:true,ready:true,mode:'live',base:'https://www.grimwear.store',blockers:[],
  quotePaymentsEnabled:true,acceptNewOrders:true,walletEnabled:false,bankTransferEnabled:false,quoteWalletEnabled:false};
const good={id:QUOTE,status:'QUOTE_READY',totalKobo:100000,expiresAt:later,paymentStatus:'not_started'};

test('allow-all quote switch is opt-in and works only in production',()=>{
  assert.equal(previewConfig({}).quoteAllApprovedEnabled,false);
  assert.equal(previewConfig({VERCEL_ENV:'preview', GRIM_QUOTE_ALL_APPROVED_ENABLED:'true'}).quoteAllApprovedEnabled,false);
  assert.equal(previewConfig({VERCEL_ENV:'production', GRIM_QUOTE_ALL_APPROVED_ENABLED:'true'}).quoteAllApprovedEnabled,true);
});
test('rollout permits all ready quotes but never pending, expired or paid ones',async()=>{
  const qs=[good,{...good,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',status:'AWAITING_QUOTE'},
    {...good,id:'cccccccc-cccc-cccc-cccc-cccccccccccc',expiresAt:earlier},
    {...good,id:'dddddddd-dddd-dddd-dddd-dddddddddddd',paymentStatus:'paid'}];
  const r=prepareRoutes({...base,quoteAllApprovedEnabled:true},{requests:qs});
  const out=await r.invoke('GET','/shipping/hybrid/requests');
  assert.equal(out.code,200);
  assert.deepEqual(out.payload.requests.map(x=>x.paymentEnabled),[true,false,false,false]);
  assert.deepEqual(out.payload.requests[0].availableMethods,{card:true,bank_transfer:false,wallet:false});
});
test('without merchant rollout flag, public card payments remain locked',async()=>{
  const r=prepareRoutes({...base,quoteTestId:null},{requests:[good]});
  const out=await r.invoke('GET','/shipping/hybrid/requests');
  assert.equal(out.payload.requests[0].paymentEnabled,false);
  assert.match(out.payload.requests[0].paymentUnavailableReason,/approved test quotation/i);
  const post=await r.invoke('POST','/shipping/hybrid/pay',{quoteId:QUOTE,method:'card'});
  assert.equal(post.code,403);
  assert.equal(post.payload.error,'TEST_QUOTE_ONLY');
});
test('rollout uses session identity and stored quote without a browser-supplied price',async()=>{
  const payments=[];
  const r=prepareRoutes({...base,quoteAllApprovedEnabled:true},{requests:[good],payments});
  const out=await r.invoke('POST','/shipping/hybrid/pay',{quoteId:QUOTE,method:'card',customerId:'attacker',totalKobo:1});
  assert.equal(out.code,200);
  assert.match(out.payload.authorizationUrl,/^https:\/\/checkout\.paystack\.com/);
  assert.equal(payments[0].customerId,'customer-1');
  assert.equal(payments[0].quoteId,QUOTE);
  assert.equal(payments[0].email,'customer@example.com');
});
test('card payments use existing installed SQL; wallet and transfers require v2',async()=>{
  const called=[];
  const fetcher=async(url,options)=>{called.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'created'})};};
  const store=createSupabaseStore({url:'https://example.supabase.co',serviceKey:'server-side-key',fetcher,mode:'live'});
  const args={quoteId:QUOTE,customerId:'customer-1',email:'c@example.com',reference:'GRIM2-12345678-1234-1234-1234-123456789abc'};
  await store.startManualQuote({...args,method:'card'});
  assert.match(called[0].url,/\/rpc\/grim2_start_manual_quote$/);
  assert.equal('p_method' in called[0].body,false);
  await store.startManualQuote({...args,method:'bank_transfer'});
  assert.match(called[1].url,/\/rpc\/grim2_start_manual_quote_v2$/);
  assert.equal(called[1].body.p_method,'bank_transfer');
  await store.startManualQuote({...args,method:'wallet'});
  assert.match(called[2].url,/\/rpc\/grim2_start_manual_quote_v2$/);
});


test('dual Paystack channels are independently disabled by default',()=>{
  assert.equal(previewConfig({}).quotePaystackDualChannelEnabled,false);
  assert.equal(previewConfig({VERCEL_ENV:'preview',GRIM_QUOTE_PAYSTACK_DUAL_CHANNEL_ENABLED:'true'}).quotePaystackDualChannelEnabled,false);
  assert.equal(previewConfig({VERCEL_ENV:'production',GRIM_QUOTE_PAYSTACK_DUAL_CHANNEL_ENABLED:'true'}).quotePaystackDualChannelEnabled,true);
});
test('when separately enabled, Paystack offers card and bank transfer for legacy quotation with one reference',async()=>{
  const initializations=[];
  const r=prepareRoutes({...base,quoteAllApprovedEnabled:true,quotePaystackDualChannelEnabled:true},{requests:[good],initializations});
  const out=await r.invoke('POST','/shipping/hybrid/pay',{quoteId:QUOTE,method:'card'});
  assert.equal(out.code,200);
  assert.deepEqual(initializations[0].channels,['card','bank_transfer']);
  assert.equal(initializations[0].amount,100000);
});
test('default quote card checkout remains strictly card-only',async()=>{
  const initializations=[];
  const r=prepareRoutes({...base,quoteAllApprovedEnabled:true,quotePaystackDualChannelEnabled:false},{requests:[good],initializations});
  const out=await r.invoke('POST','/shipping/hybrid/pay',{quoteId:QUOTE,method:'card'});
  assert.equal(out.code,200);
  assert.deepEqual(initializations[0].channels,['card']);
});

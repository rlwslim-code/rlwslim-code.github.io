"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../../src/checkout2/grim-checkout-v2.cjs');
const { createSupabaseStore } = require('../../src/checkout2/adapters.cjs');
const ref='GRIM2-104532fe-59df-4835-9152-554a387025f5';
const row={reference:ref,customer_id:'merchant',email:'merchant@example.test',status:'pending',method:'card',
  quote:{totalKobo:100000},order_id:null};
const payment={domain:'live',status:'success',reference:ref,amount:100000,requested_amount:100000,
  fees:0,currency:'NGN',id:1234,customer:{email:'merchant@example.test'},channel:'card'};
test('failed Supabase finish logs SQLSTATE without leaking sensitive details or falsely marking paid',async()=>{
  const logs=[],orig=console.error; console.error=(...args)=>logs.push(args);
  const statuses=[];
  let retrySucceeds=false, writes=0, verified=0;
  const store={get:async()=>({...row}),complete:async()=>{
    writes++;
    if(!retrySucceeds){ const err=new Error('Checkout database request failed');
      err.operation='grim2_finish_card_live_verified';err.code='23502';
      err.databaseMessage='null value for email merchant@example.test';
      throw err;
    }
    return {...row,status:'paid',order_id:'order-1',provider_id:'1234'};
  },flag:async(reference,status)=>{statuses.push([reference,status])}};
  const engine=createEngine({catalog:async()=>({}),store,provider:{verify:async()=>{verified++;return payment;}},callbackBase:'https://grimwear.store',mode:'live'});
  try {
    const failed=await engine.confirm({reference:ref,customerId:'merchant'});
    assert.equal(failed.status,'reconciliation_required');
    assert.equal(failed.orderId,null);
    assert.match(failed.message,/do not pay again/i);
    assert.deepEqual(statuses,[[ref,'reconciliation_required']]);
    assert.equal(writes,1);
    assert.equal(logs.length,1);
    assert.equal(logs[0][1].dbCode,'23502');
    assert.ok(!JSON.stringify(logs).includes('merchant@example.test'));
    retrySucceeds=true;
    const recovered=await engine.confirm({reference:ref,customerId:'merchant'});
    assert.equal(recovered.status,'paid');
    assert.equal(recovered.orderId,'order-1');
    assert.equal(writes,2);
    assert.equal(verified,2);
  } finally { console.error=orig; }
});
test('database RPC preserves failure code only on server and never returns raw details to client',async()=>{
  const store=createSupabaseStore({url:'https://dummy.supabase.co',serviceKey:'dummy',mode:'live',fetcher:async()=>({
    ok:false,status:400,json:async()=>({code:'23514',message:'violates order status constraint'})
  })});
  await assert.rejects(store.complete({reference:ref,providerId:'1234',evidence:{ok:true}}),err=>{
    assert.equal(err.code,'23514');
    assert.equal(err.operation,'grim2_finish_card_live_verified');
    assert.equal(err.message,'Checkout database request failed');
    return true;
  });
});
test('unsuccessful Paystack payment never inserts an order or flags payment as confirmed',async()=>{
  let writes=0; const store={get:async()=>({...row}),complete:async()=>{writes++},flag:async()=>{writes++}};
  const engine=createEngine({catalog:async()=>({}),store,provider:{verify:async()=>({...payment,status:'pending'})},callbackBase:'https://grimwear.store',mode:'live'});
  const result=await engine.confirm({reference:ref,customerId:'merchant'});
  assert.equal(result.status,'pending'); assert.equal(writes,0);
});

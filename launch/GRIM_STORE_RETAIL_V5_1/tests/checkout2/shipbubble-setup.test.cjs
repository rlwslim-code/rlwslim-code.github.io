'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createProviderSetup, ShipbubbleSetupError} = require('../../src/checkout2/shipbubble-setup.cjs');
const mockReply = (data, status = 200) => ({ok: status < 400, status, json: async () => data});

test('reads real-format provider address codes and categories without writing', async () => {
  const calls = [];
  const provider = createProviderSetup({apiKey:'sb_prod_PRIVATE_TEST_KEY', fetchImpl: async (url, init) => {
    calls.push({url, init});
    if(url.endsWith('/address')) return mockReply({status:'success', data:{results:[
      {address_code:125, address_data:{city:'Lagos',state:'Lagos',country_code:'NG',formatted_address:'Lagos'}},
      {address_code:987, address_data:{city:'Oye-Ekiti',state:'Ekiti',country_code:'NG',formatted_address:'Oye, Ekiti'}},
      {address_code:999, address_data:{city:'Dallas',state:'Texas',country_code:'US'}}
    ]}});
    if(url.endsWith('/labels/categories')) return mockReply({status:'success',data:[{category_id:800,category:'Fashion wears'}]});
    throw Error('Unexpected path');
  }});
  const data=await provider();
  assert.deepEqual(data.addresses.map(a=>a.addressCode), [987,125]);
  assert.deepEqual(data.categories, [{categoryId:800,name:'Fashion wears'}]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.headers.Authorization, 'Bearer sb_prod_PRIVATE_TEST_KEY');
    assert.equal(call.init.body, undefined);
  }
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_TEST_KEY/);
});

test('rejects no key without contacting provider', () => {
  assert.throws(()=>createProviderSetup({apiKey:''}), e=>e.code==='SHIPBUBBLE_KEY_MISSING');
});

test('fails without exposing provider error payload or key', async () => {
  const provider=createProviderSetup({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl: async()=>mockReply({status:'failed',message:'SECRET_VALUE'},401)});
  await assert.rejects(provider(), e=>e instanceof ShipbubbleSetupError && e.code==='SHIPBUBBLE_AUTH_REJECTED' && !JSON.stringify(e).includes('SECRET_VALUE'));
});

test('fails closed when addresses response has wrong shape', async () => {
  const provider=createProviderSetup({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl: async (url)=>mockReply(url.endsWith('/address') ? {status:'success',data:{}} : {status:'success',data:[]})});
  await assert.rejects(provider(), e=>e.code==='PROVIDER_RESPONSE_INVALID');
});

test('reports connection problems without logging or leaking a key', async () => {
  const provider=createProviderSetup({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl: async()=>{throw new Error('network lost: hidden sensitive info');}});
  await assert.rejects(provider(), e=>e.code==='SHIPBUBBLE_UNAVAILABLE' && !e.message.includes('sensitive'));
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSenderValidator,validateSenderInput}=require('../../src/checkout2/shipbubble-validate.cjs');
const SENDER={name:'Test Sender',email:'sender@example.test',phone:'+2348012345678',address:'Some Street, Oye, Ekiti State, Nigeria'};
const mockReply=(data,status=200)=>({ok:status<400,status,json:async()=>data});

test('successful validation posts only approved sender details and returns safe fields',async()=>{
  const calls=[];
  const validator=createSenderValidator({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl:async(url,init)=>{
    calls.push({url,init});
    return mockReply({status:'success',data:{address_code:12345,city:'Oye',state:'Ekiti',country:'Nigeria',country_code:'NG',formatted_address:'Oye, Ekiti, Nigeria',email:'SECRET_PROVIDER_EMAIL'}});
  }});
  const result=await validator(SENDER);
  assert.deepEqual(result,{addressCode:12345,formattedAddress:'Oye, Ekiti, Nigeria',city:'Oye',state:'Ekiti',countryCode:'NG'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.shipbubble.com/v1/shipping/address/validate');
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.headers.Authorization,'Bearer sb_prod_PRIVATE_TEST_KEY');
  assert.deepEqual(JSON.parse(calls[0].init.body),SENDER);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST_KEY|SECRET_PROVIDER_EMAIL/);
});

test('requires complete Nigerian sender details without calling Shipbubble',async()=>{
  let calls=0;
  const validator=createSenderValidator({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl:async()=>{calls++;throw Error('should not call');}});
  await assert.rejects(validator({...SENDER,address:'New York, USA'}), e=>e.code==='INVALID_SENDER' && e.status===400);
  assert.equal(calls,0);
  assert.throws(()=>validateSenderInput({...SENDER,email:'not-email'}),e=>e.code==='INVALID_SENDER');
});

test('rejects missing key, unauthorized key and unsafe provider responses',async()=>{
  assert.throws(()=>createSenderValidator({apiKey:''}),e=>e.code==='SHIPBUBBLE_KEY_MISSING');
  const unauthorized=createSenderValidator({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl:async()=>mockReply({message:'SECRET_PROVIDER_PAYLOAD'},401)});
  await assert.rejects(unauthorized(SENDER),e=>e.code==='SHIPBUBBLE_AUTH_REJECTED'&&!e.message.includes('SECRET'));
  const invalidCountry=createSenderValidator({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl:async()=>mockReply({status:'success',data:{address_code:4444,country_code:'US'}})});
  await assert.rejects(invalidCountry(SENDER),e=>e.code==='SHIPBUBBLE_RESPONSE_INVALID');
});

test('does not retry automatically after transport failures',async()=>{
  let calls=0;
  const validator=createSenderValidator({apiKey:'sb_prod_PRIVATE_TEST_KEY',fetchImpl:async()=>{calls++;throw Error('connection interruption');}});
  await assert.rejects(validator(SENDER),e=>e.code==='SHIPBUBBLE_UNAVAILABLE');
  assert.equal(calls,1);
});

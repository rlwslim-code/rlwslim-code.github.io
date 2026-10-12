'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {createShipbubbleQuotes,ngnKobo} = require('../../src/checkout2/shipbubble-quotes.cjs');
const valid = {apiKey:'sb_sandbox_TESTKEY',senderAddressCode:1234, categoryId:98246239};
test('precise naira-to-kobo conversion',()=>{assert.equal(ngnKobo('3063.20'),306320);assert.equal(ngnKobo(2800),280000);assert.throws(()=>ngnKobo('-5'));assert.throws(()=>ngnKobo('NaN'));});
test('rejects missing configuration',()=>assert.throws(()=>createShipbubbleQuotes({...valid,apiKey:''})));
test('rejects incomplete address before API call',async()=>{const client=createShipbubbleQuotes(valid);await assert.rejects(client.validateDestination({name:'a'}),{code:'INVALID_ADDRESS'});});
test('validates Nigeria destination and returns address code',async()=>{
 const client=createShipbubbleQuotes({...valid,fetchImpl:async()=>({ok:true,json:async()=>({status:'success',data:{country_code:'NG',address_code:735}})})});
 assert.equal(await client.validateDestination({name:'Customer',email:'test@example.com',phone:'08012345678',address:'Oye Ekiti, Nigeria'}),735);
});
test('rejects international delivery',async()=>{
 const client=createShipbubbleQuotes({...valid,fetchImpl:async()=>({ok:true,json:async()=>({status:'success',data:{country_code:'GH',address_code:735}})})});
 await assert.rejects(client.validateDestination({name:'Customer',email:'test@example.com',phone:'08012345678',address:'Accra, Ghana'}),{code:'UNSUPPORTED_DESTINATION'});
});
test('quotes only pickup couriers and uses customer-facing rate_card_amount',async()=>{
 let url;
 const client=createShipbubbleQuotes({...valid,fetchImpl:async(u)=>{url=u;return {ok:true,json:async()=>({status:'success',data:{request_token:'token',couriers:[
  {courier_id:'one',service_code:'courier',courier_name:'Courier',service_type:'pickup',rate_card_currency:'NGN',rate_card_amount:3500.75,total:100},
  {courier_id:'two',service_code:'drop',courier_name:'Drop-off',service_type:'dropoff',rate_card_currency:'NGN',rate_card_amount:100}
 ]}})};}});
 const result=await client.fetchRates({destinationCode:735,pickupDate:'2026-10-12',items:[{name:'Hoodie',description:'Packed hoodie',quantity:1,unit_weight:0.6,unit_amount:28000}],dimension:{length:30,width:20,height:10}});
 assert.equal(url,'https://api.shipbubble.com/v1/shipping/fetch_rates');assert.equal(result.couriers.length,1);assert.equal(result.couriers[0].amountKobo,350075);
});
test('never silently defaults to free shipping on provider outage',async()=>{
 const client=createShipbubbleQuotes({...valid,fetchImpl:async()=>{throw Error('offline')}});
 await assert.rejects(client.fetchRates({destinationCode:735,pickupDate:'2026-10-12',items:[{name:'Hoodie',description:'Packed hoodie',quantity:1,unit_weight:0.6,unit_amount:28000}],dimension:{length:30,width:20,height:10}}),{code:'PROVIDER_UNAVAILABLE'});
});

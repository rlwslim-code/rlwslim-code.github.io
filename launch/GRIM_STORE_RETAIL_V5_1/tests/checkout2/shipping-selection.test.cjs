'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createShippingSelection} = require('../../src/checkout2/shipping-selection.cjs');
const settings = {customerId:'customer-A',destinationCode:123,cartFingerprint:'server-computed-cart-hash'};
const choice = { ...settings,requestToken:'provider-quote-token',courier:{courierId:'courier-1',serviceCode:'pickup',amountKobo:470000}};
test('valid server signed shipping price retains courier and amount',()=>{
 const s=createShippingSelection({secret:'very-long-server-side-secret-value-1234567890',now:()=>1000});
 const x=s.verify(s.sign(choice),settings);
 assert.equal(x.amountKobo,470000); assert.equal(x.courierId,'courier-1');
});
test('cannot alter a courier amount without invalidating signature',()=>{
 const s=createShippingSelection({secret:'very-long-server-side-secret-value-1234567890',now:()=>1000});
 const [data,sig]=s.sign(choice).split('.');
 const payload=JSON.parse(Buffer.from(data,'base64url').toString());payload.amountKobo=1;
 assert.throws(()=>s.verify(`${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`,settings));
});
test('cannot use other customer or cart',()=>{
 const s=createShippingSelection({secret:'very-long-server-side-secret-value-1234567890',now:()=>1000});
 const t=s.sign(choice);
 assert.throws(()=>s.verify(t,{...settings,customerId:'customer-B'}));
 assert.throws(()=>s.verify(t,{...settings,cartFingerprint:'different-cart'}));
});
test('reject expired quotes',()=>{
 let instant=1000;
 const s=createShippingSelection({secret:'very-long-server-side-secret-value-1234567890',now:()=>instant,ttlMs:10000});
 const t=s.sign(choice);instant=11000;
 assert.throws(()=>s.verify(t,settings));
});
test('reject unconfigured server signing secret',()=>{
 assert.throws(()=>createShippingSelection({secret:'short'}));
});

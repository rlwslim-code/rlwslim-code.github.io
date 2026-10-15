"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveLocale}=require('../../src/checkout2/country-context.cjs');
const {previewConfig}=require('../../src/checkout2/preview-config.cjs');
test('country metadata does not misrepresent payment currency',()=>{
 const r=resolveLocale({headers:{'x-vercel-ip-country':'US'}});
 assert.equal(r.country,'US'); assert.equal(r.displayCurrency,'USD');assert.equal(r.settlementCurrency,'NGN');
 assert.equal(r.displayConversionAvailable,false);
});
test('merchant pilot requires explicit production gates and valid email',()=>{
 let r=previewConfig({VERCEL_ENV:'preview',GRIM_QUOTE_MERCHANT_TEST_ENABLED:'true',GRIM_QUOTE_MERCHANT_TEST_EMAIL:'x@test.com'});
 assert.equal(r.quoteMerchantTestEnabled,false);
 r=previewConfig({VERCEL_ENV:'production',GRIM_QUOTE_MERCHANT_TEST_ENABLED:'true',GRIM_QUOTE_MERCHANT_TEST_EMAIL:'Owner@Test.com'});
 assert.equal(r.quoteMerchantTestEnabled,true);assert.equal(r.quoteMerchantTestEmail,'owner@test.com');
});

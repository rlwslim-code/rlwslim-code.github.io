"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { previewConfig } = require("../../src/checkout2/preview-config.cjs");
const { verifyProvider, paystackSignatureIsValid } = require("../../src/checkout2/checkout-core.cjs");
const { createPaystack } = require("../../src/checkout2/adapters.cjs");
const { createEngine } = require("../../src/checkout2/grim-checkout-v2.cjs");
const live = {
 VERCEL_ENV: "production", GRIM_CHECKOUT2_LIVE_ENABLED: "true",
 GRIM_CHECKOUT2_PROD_DB_CONFIRMED: "true",
 GRIM_CHECKOUT2_LIVE_PAYSTACK_SECRET_KEY: "sk_live_fakefixture",
 GRIM_CHECKOUT2_PUBLIC_ORIGIN: "https://www.grimwear.store",
 SUPABASE_URL: "https://liveproject.supabase.co", SUPABASE_SECRET_KEY: "fake-service-key",
 SESSION_SECRET: "x".repeat(48), GRIM_CHECKOUT2_LIVE_WALLET_ENABLED:"true",
 GRIM_CHECKOUT2_SHIPPING_CONFIRMED:"true", GRIM_CHECKOUT2_SHIPPING_KOBO:"0"
};
test("production live mode requires explicit gates", () => {
 const c=previewConfig(live);
 assert.equal(c.mode, "live"); assert.equal(c.ready, true); assert.equal(c.walletEnabled,true);
});
for(const [name,changes] of Object.entries({
 off:{GRIM_CHECKOUT2_LIVE_ENABLED:"false"},
 migration:{GRIM_CHECKOUT2_PROD_DB_CONFIRMED:"false"},
 testKey:{GRIM_CHECKOUT2_LIVE_PAYSTACK_SECRET_KEY:"sk_test_fixture"},
 previewKey:{VERCEL_ENV:"preview"},
 origin:{GRIM_CHECKOUT2_PUBLIC_ORIGIN:"https://attacker.example"},
 missingService:{SUPABASE_SECRET_KEY:""},
 shortSecret:{SESSION_SECRET:"short"},
 missingURL:{SUPABASE_URL:""},
 unsupported:{VERCEL_ENV:"development",GRIM_CHECKOUT2_LOCAL:"false"}
})) test(`production refuses ${name}`,()=>assert.equal(previewConfig({...live,...changes}).ready,false));
test("production wallet is OFF unless separately approved",()=>{
 const c=previewConfig({...live, GRIM_CHECKOUT2_LIVE_WALLET_ENABLED:"false"});
 assert.equal(c.ready,true);assert.equal(c.walletEnabled,false);
});
test("test mode never accepts live key",()=> {
 const c=previewConfig({VERCEL_ENV:"preview",VERCEL_URL:"preview.vercel.app",GRIM_CHECKOUT2_ENABLED:"true",
 GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY:"sk_live_incorrect",GRIM_CHECKOUT2_DB_ISOLATED:"true",
 GRIM_CHECKOUT2_SUPABASE_URL:"https://testproject.supabase.co",
 GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY:"fake",SESSION_SECRET:"x".repeat(40)});
 assert.equal(c.ready,false);
});
const expected={reference:"GRIM2-example",email:"one@example.test",totalKobo:2800000};
const valid=(domain="live")=>({domain,reference:expected.reference,currency:"NGN",
 amount:2852792,requested_amount:2800000,fees:52792,id:6639631964,
 status:"success",customer:{email:"ONE@example.test"}});
test("fee-inclusive LIVE payment preserves reference amount and identity",()=> {
 assert.equal(verifyProvider({expected,provider:valid(),mode:"live"}).providerId,"6639631964");
});
test("normal LIVE payment without pass-through fees",()=> {
 const p={...valid(),amount:2800000,fees:52792,requested_amount:2800000};
 assert.ok(verifyProvider({expected,provider:p,mode:"live"}));
});
for(const [name,changes] of Object.entries({
 wrongMode:{domain:"test"}, wrongReference:{reference:"other"},
 wrongOriginalAmount:{requested_amount:1}, wrongFees:{fees:52791},
 tooLow:{amount:2799999}, wrongEmail:{customer:{email:"another@example.test"}},
 wrongCurrency:{currency:"USD"}, missingId:{id:null}
})) test(`rejects fee-tampered LIVE ${name}`,()=>
 assert.throws(()=>verifyProvider({expected,provider:{...valid(),...changes},mode:"live"}),/match|Payment/i));
test("Webhook signs only with matching LIVE key",()=> {
 const secret="sk_live_fixture";const raw=Buffer.from('{"event":"charge.success"}');
 const sig=crypto.createHmac("sha512",secret).update(raw).digest("hex");
 assert.equal(paystackSignatureIsValid(raw,sig,secret,"live"),true);
 assert.equal(paystackSignatureIsValid(raw,sig,secret,"test"),false);
 assert.equal(paystackSignatureIsValid(raw,sig,"sk_live_wrong","live"),false);
});
test("Paystack live adapter rejects a test secret",()=> {
 assert.throws(()=>createPaystack("sk_test_fixture",fetch,"live"));
 assert.doesNotThrow(()=>createPaystack("sk_live_fixture",fetch,"live"));
});
test("fully paid wallet replay never calls debit again",async()=> {
 let count=0;
 const row={reference:"GRIM2-12345678-1234-1234-1234-123456789abc",customer_id:"customer",
 status:"paid",method:"wallet",quote:{totalKobo:50000},order_id:"ORD_1"};
 const store={get:async()=>row,byKey:async()=>row,completeWallet:async()=>{count++;return row;}};
 const engine=createEngine({catalog:async()=>({}),store,provider:{},callbackBase:"https://www.grimwear.store",mode:"live"});
 const a=await engine.start({customerId:"customer",email:"buyer@example.test",key:"1234567890abcdef",method:"wallet"});
 const b=await engine.start({customerId:"customer",email:"buyer@example.test",key:"1234567890abcdef",method:"wallet"});
 assert.equal(a.status,"paid");assert.equal(b.status,"paid");assert.equal(count,0);
});
test("wallet flag stops a new LIVE debit",async()=> {
 let count=0;
 const row={reference:"GRIM2-12345678-1234-1234-1234-123456789abc",customer_id:"customer",
 status:"created",method:"wallet",quote:{totalKobo:50000}};
 const store={byKey:async()=>row,completeWallet:async()=>{count++;return row;}};
 const engine=createEngine({catalog:async()=>({}),store,provider:{},callbackBase:"https://www.grimwear.store",mode:"live",walletEnabled:false});
 await assert.rejects(engine.start({customerId:"customer",email:"buyer@example.test",key:"1234567890abcdef",method:"wallet"}),/unavailable/i);
 assert.equal(count,0);
});

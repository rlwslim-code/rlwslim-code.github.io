const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const {
  buildQuote,
  verifyProvider,
  paystackSignatureIsValid,
  authorizationOK,
  address,
} = require("../../src/checkout2/checkout-core.cjs");
const { previewConfig } = require("../../src/checkout2/preview-config.cjs");
const { createPaystack } = require("../../src/checkout2/adapters.cjs");
const valid = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "grim-test.vercel.app",
  GRIM_CHECKOUT2_ENABLED: "true",
  GRIM_CHECKOUT2_DB_ISOLATED: "true",
  GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY: "sk_test_fixtureonly",
  GRIM_CHECKOUT2_SUPABASE_URL: "https://sandbox.supabase.co",
  GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY: "fixtureonly",
  SESSION_SECRET: "a".repeat(40),
};
test("complete isolated Preview configuration succeeds", () =>
  assert.equal(previewConfig(valid).ready, true));
for (const [name, change] of Object.entries({
  production: { VERCEL_ENV: "production" },
  liveKey: { GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY: "sk_live_example" },
  noConfirmation: { GRIM_CHECKOUT2_DB_ISOLATED: "false" },
  sameDatabase: { SUPABASE_URL: valid.GRIM_CHECKOUT2_SUPABASE_URL },
  shortSession: { SESSION_SECRET: "short" },
  missingTestKey: { GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY: undefined },
  badPreviewHost: { VERCEL_URL: "attacker.example" },
  disabled: { GRIM_CHECKOUT2_ENABLED: "false" },
}))
  test(`configuration rejects ${name}`, () =>
    assert.equal(previewConfig({ ...valid, ...change }).ready, false));
test("Paystack adapter rejects live secrets", () =>
  assert.throws(() => createPaystack("sk_live_fake"), /test key/));
const catalog = { 1: { active: true, priceKobo: 1800000, name: "Tee" } },
  line = { productId: "1", quantity: 1, size: "M" };
test("ignores browser prices and calculates kobo from catalog", () =>
  assert.equal(
    buildQuote({ lines: [{ ...line, price: 1, total: 1 }], catalog }).totalKobo,
    1800000,
  ));
test("same product in different sizes remains distinct", () =>
  assert.equal(
    buildQuote({ lines: [line, { ...line, size: "L" }], catalog }).totalKobo,
    3600000,
  ));
for (const [name, bad] of Object.entries({
  fraction: { ...line, quantity: 1.5 },
  zero: { ...line, quantity: 0 },
  huge: { ...line, quantity: 100 },
  badSize: { ...line, size: "evil" },
  prototype: { ...line, productId: "__proto__" },
  missing: null,
}))
  test(`rejects invalid cart ${name}`, () =>
    assert.throws(() => buildQuote({ lines: [bad], catalog })));
test("rejects duplicate product/size lines", () =>
  assert.throws(() => buildQuote({ lines: [line, line], catalog })));
test("rejects inactive catalog products", () =>
  assert.throws(() =>
    buildQuote({
      lines: [line],
      catalog: { 1: { active: false, priceKobo: 1 } },
    }),
  ));
test("rejects control characters in addresses", () =>
  assert.throws(() =>
    address({
      country: "NG",
      address: "Test\nInjected",
      city: "A",
      state: "B",
    }),
  ));
const expected = {
  reference: "ref",
  email: "test@example.com",
  totalKobo: 100,
};
const payment = {
  reference: "ref",
  domain: "test",
  amount: 100,
  id: 123,
  status: "success",
  currency: "NGN",
  customer: { email: "TEST@example.com" },
};
test("matches server-side provider verification", () =>
  assert.equal(
    verifyProvider({ expected, provider: payment }).providerId,
    "123",
  ));
for (const [name, bad] of Object.entries({
  live: { domain: "live" },
  amount: { amount: 1 },
  currency: { currency: "USD" },
  reference: { reference: "other" },
  customer: { customer: { email: "other@example.com" } },
  id: { id: null },
}))
  test(`rejects provider mismatch ${name}`, () =>
    assert.throws(() =>
      verifyProvider({ expected, provider: { ...payment, ...bad } }),
    ));
test("verifies raw-body HMAC and rejects altered payload", () => {
  const raw = Buffer.from('{"event":"charge.success"}'),
    secret = "sk_test_fixtureonly",
    signature = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  assert.equal(paystackSignatureIsValid(raw, signature, secret), true);
  assert.equal(
    paystackSignatureIsValid(Buffer.from("{}"), signature, secret),
    false,
  );
  assert.equal(paystackSignatureIsValid(raw, "00", secret), false);
  assert.equal(
    paystackSignatureIsValid(JSON.parse(raw), signature, secret),
    false,
  );
});
for (const u of [
  "https://evil.example",
  "http://checkout.paystack.com/a",
  "https://checkout.paystack.com.evil/a",
  "https://user:password@checkout.paystack.com/a",
  "javascript:alert(1)",
])
  test(`rejects redirect ${u}`, () => assert.equal(authorizationOK(u), false));
test("initialization is card-only and supplies the trusted callback", async () => {
  let request;
  const p = createPaystack("sk_test_fixtureonly", async (url, opts) => {
    request = { url, body: JSON.parse(opts.body) };
    return {
      ok: true,
      json: async () => ({
        status: true,
        data: { authorization_url: "https://checkout.paystack.com/test" },
      }),
    };
  });
  await p.initialize({
    channels: ["card"],
    callback_url: "https://grim-test.vercel.app/checkout2.html",
    amount: 100,
  });
  assert.deepEqual(request.body.channels, ["card"]);
  assert.equal(request.url, "https://api.paystack.co/transaction/initialize");
});

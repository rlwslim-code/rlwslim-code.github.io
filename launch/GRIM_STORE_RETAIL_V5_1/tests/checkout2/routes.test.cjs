const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  crypto = require("node:crypto");
const { createRoutes } = require("../../src/checkout2/routes.cjs");
const { fixture, input, config } = require("./fixture.cjs");
let f, server, base;
test.before(async () => {
  f = await fixture();
  const app = express();
  app.use("/api/checkout2/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers["x-test-customer"])
      req.user = {
        id: req.headers["x-test-customer"],
        email: "test@example.com",
        password_hash: "must-not-be-exposed",
      };
    next();
  });
  app.use(
    "/api/checkout2",
    createRoutes({
      catalog: f.catalog,
      sessionUser: (req) => req.user,
      config,
      store: f.store,
      provider: f.provider,
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/checkout2/`;
});
test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (f) await f.close();
});
async function request(path, data, extra = {}) {
  return fetch(base + path, {
    headers: {
      "Content-Type": "application/json",
      Origin: config.base,
      "x-test-customer": "customer-http",
      ...extra,
    },
    ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
  });
}
test("config reports ready without leaking secrets", async () => {
  const r = await fetch(base + "config"),
    body = await r.json();
  assert.equal(body.ready, true);
  assert.equal(JSON.stringify(body).includes(config.secret), false);
});
test("all customer routes reject anonymous requests", async () => {
  const r = await fetch(base + "account");
  assert.equal(r.status, 401);
});
test("cross-origin and absent-origin mutations are rejected", async () => {
  for (const origin of ["https://attacker.vercel.app", "null", ""])
    assert.equal(
      (await request("start", input, { Origin: origin })).status,
      403,
    );
});
test("server session overrides spoofed customer and email", async () => {
  const r = await request("start", {
    ...input,
    email: "evil@example.com",
    customerId: "other",
  });
  assert.equal(r.status, 200);
  const body = await r.json(),
    row = await f.store.get(body.reference);
  assert.equal(row.customer_id, "customer-http");
  assert.equal(row.email, "test@example.com");
});
test("account has private no-store responses and no credential fields", async () => {
  const r = await request("account"),
    body = await r.json();
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(body.customer.password_hash, undefined);
});
test("foreign reference returns 404", async () => {
  const pending = await f.store.pending("customer-http");
  assert.equal(
    (
      await request(
        "confirm",
        { reference: pending[0].reference },
        { "x-test-customer": "other" },
      )
    ).status,
    404,
  );
});
test("unsigned webhook is rejected without recording orders", async () => {
  assert.equal(
    (await request("webhook", { event: "charge.success" })).status,
    401,
  );
});
test("signed raw webhook records payment and safely handles retries", async () => {
  const row = (await f.store.pending("customer-http"))[0];
  const data = {
    event: "charge.success",
    data: { reference: row.reference, domain: "test" },
  };
  const signature = crypto
    .createHmac("sha512", config.secret)
    .update(JSON.stringify(data))
    .digest("hex");
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request("webhook", data, {
          "x-paystack-signature": signature,
          "x-test-customer": "",
        })
      ).status,
      200,
    );
  assert.equal((await f.store.get(row.reference)).status, "paid");
});
test("signed webhook with tampered data is rejected", async () => {
  const signature = crypto
    .createHmac("sha512", config.secret)
    .update("{}")
    .digest("hex");
  assert.equal(
    (
      await request(
        "webhook",
        { event: "charge.success" },
        { "x-paystack-signature": signature },
      )
    ).status,
    401,
  );
});
test("malformed reference is rejected without provider call", async () => {
  const before = f.stats.verified;
  assert.equal(
    (await request("confirm", { reference: "../../foreign" })).status,
    400,
  );
  assert.equal(before, f.stats.verified);
});

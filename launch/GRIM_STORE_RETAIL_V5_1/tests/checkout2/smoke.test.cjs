const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grim-checkout-smoke-"));
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.GRIM_CHECKOUT2_ENABLED = "true";
  process.env.SESSION_SECRET = "fixture-session-secret-at-least-32-characters";
  process.env.DATA_DIR = dir;
  // A production credential exists but Preview must never initialize that client.
  process.env.SUPABASE_URL = "https://production-sentinel.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "not-a-real-key";
  delete process.env.GRIM_CHECKOUT2_SUPABASE_URL;
  delete process.env.GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY;
  const { default: app } = await import("../../src/server.js");
  const { grimSupabase } = await import("../../src/grim-control/supabase.js");
  assert.equal(grimSupabase, null);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
test("full Preview server serves existing storefront, shop, story and admin", async () => {
  for (const p of ["/", "/shop.html", "/story.html", "/admin.html"])
    assert.equal((await fetch(base + p)).status, 200, p);
});
test("existing catalog and market APIs continue responding", async () => {
  assert.equal(
    Array.isArray(await (await fetch(base + "/api/products")).json()),
    true,
  );
  assert.equal(
    (await (await fetch(base + "/api/market")).json()).country,
    "NG",
  );
});
test("all legacy payment and wallet routes are blocked on Preview", async () => {
  for (const p of [
    "/api/payments/initialize",
    "/api/payments/charge-saved",
    "/api/wallet/pay",
    "/api/v8/wallet/checkout",
    "/api/v8/wallet/fund/initialize",
  ])
    assert.equal(
      (
        await fetch(base + p, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
      p,
    );
});
test("Checkout 2.0 fails closed when isolated credentials are missing", async () => {
  const c = await (await fetch(base + "/api/checkout2/config")).json();
  assert.equal(c.enabled, true);
  assert.equal(c.ready, false);
  assert.equal(
    (
      await fetch(base + "/api/checkout2/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    503,
  );
});
test("new checkout assets are served without disturbing original pages", async () => {
  for (const p of [
    "/checkout2.html",
    "/checkout2.css",
    "/checkout2.js",
    "/checkout2-bridge.js",
  ])
    assert.equal((await fetch(base + p)).status, 200);
});

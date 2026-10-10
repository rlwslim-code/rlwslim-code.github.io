const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  path = require("node:path");
const { createSupabaseStore } = require("../../src/checkout2/adapters.cjs");
const { createEngine } = require("../../src/checkout2/grim-checkout-v2.cjs");
const shipping = {
  country: "NG",
  address: "12 Test Road",
  city: "Lagos",
  state: "Lagos",
  postal: "100001",
};
const input = {
  customerId: "test-customer",
  email: "test@example.com",
  key: "idempotency_key_00001",
  method: "card",
  expectedTotalKobo: 1800000,
  lines: [{ productId: "1", quantity: 1, size: "M" }],
  shipping,
  billing: shipping,
  contact: { firstName: "Test", lastName: "Customer", phone: "+2348000000000" },
};
const config = {
  ready: true,
  enabled: true,
  preview: true,
  local: false,
  base: "https://grim-test.vercel.app",
  secret: "sk_test_fixtureonly",
  blockers: [],
};
async function fixture() {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create table public.customers(id text primary key,email text); insert into public.customers values ('sentinel','preserved@example.com');",
  );
  const migration = fs.readFileSync(
    path.join(__dirname, "../../sql/002_checkout2_preview.sql"),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(fs.readFileSync(path.join(__dirname,"../../sql/004_checkout2_shipping_evidence.sql"),"utf8"));
  const rpc = async (name, payload) => {
    const entries = Object.entries(payload),
      args = entries.map(([k], i) => `${k} => $${i + 1}`).join(",");
    return (
      await db.query(
        `select public.${name}(${args}) as result`,
        entries.map(([, v]) => (typeof v === "object" ? JSON.stringify(v) : v)),
      )
    ).rows[0].result;
  };
  const store = createSupabaseStore({
    url: "https://test.supabase.co",
    serviceKey: "fixtureonly",
    fetcher: async (url, options) => {
      try {
        const data = await rpc(url.split("/").pop(), JSON.parse(options.body));
        return { ok: true, json: async () => data };
      } catch (e) {
        return {
          ok: false,
          json: async () => ({ message: e.message, code: e.code }),
        };
      }
    },
  });
  const stats = { initialized: 0, verified: 0 };
  let status = "success",
    mismatch = {},
    failure = false;
  const provider = {
    initialize: async () => {
      stats.initialized++;
      if (failure) throw Error("timeout");
      return { authorization_url: "https://checkout.paystack.com/fixtureonly" };
    },
    verify: async (reference) => {
      stats.verified++;
      const row = await store.get(reference);
      return {
        id: 123,
        domain: "test",
        status,
        reference,
        currency: "NGN",
        amount: row.quote.totalKobo,
        customer: { email: row.email },
        ...mismatch,
      };
    },
  };
  const catalog = async () => ({
    1: { active: true, priceKobo: 1800000, name: "Veil Tee", color: "Veil" },
    2: { active: false, priceKobo: 2000000 },
  });
  const engine = createEngine({
    catalog,
    store,
    provider,
    callbackBase: config.base,
  });
  return {
    db,
    store,
    provider,
    catalog,
    engine,
    stats,
    rpc,
    migration,
    setStatus: (v) => (status = v),
    setMismatch: (v) => (mismatch = v),
    setFailure: (v) => (failure = v),
    close: () => db.close(),
  };
}
module.exports = { fixture, input, shipping, config };

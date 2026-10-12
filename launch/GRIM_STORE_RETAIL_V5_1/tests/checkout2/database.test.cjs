const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { fixture, input } = require("./fixture.cjs");
let f;
test('stale reviewed total cannot initialize a card or debit a wallet',async()=>{
 const before=f.stats.initialized;
 for(const method of ['card','wallet'])await assert.rejects(f.engine.start({...input,method,customerId:'price-change-'+method,key:'price_changed_key_00001',expectedTotalKobo:1}),/total changed/);
 assert.equal(f.stats.initialized,before);
 assert.equal((await f.db.query("select count(*)::int n from grim2_attempts where customer_id like 'price-change-%'")).rows[0].n,0);
});
test.before(async () => {
  f = await fixture();
});
test.after(async () => {
  if (f) await f.close();
});
const start = (suffix, extra = {}) =>
  f.engine.start({
    ...input,
    customerId: `customer-${suffix}`,
    email: `${suffix}@example.com`,
    key: `checkout_key_${suffix}_000000`,
    ...extra,
  });
test("migration is additive, repeatable and preserves existing records", async () => {
  await f.db.exec(f.migration);
  assert.equal(
    (await f.db.query("select email from customers")).rows[0].email,
    "preserved@example.com",
  );
});
test("parallel start retries initialize once and return one reference", async () => {
  const count = f.stats.initialized;
  const results = await Promise.all(
    Array.from({ length: 6 }, () => start("parallel")),
  );
  assert.equal(new Set(results.map((x) => x.reference)).size, 1);
  assert.equal(f.stats.initialized - count, 1);
});
test("different keys return the outstanding payment", async () => {
  const a = await start("parallel", { key: "different_checkout_key_00001" });
  const rows = await f.db.query(
    "select count(*)::int n from grim2_attempts where customer_id='customer-parallel'",
  );
  assert.equal(rows.rows[0].n, 1);
  assert.equal(
    a.reference,
    (await f.store.pending("customer-parallel"))[0].reference,
  );
});
test("verification records one durable Supabase order", async () => {
  const s = await start("paid");
  const r = await f.engine.confirm({
    reference: s.reference,
    customerId: "customer-paid",
  });
  assert.equal(r.status, "paid");
  assert.equal(
    (
      await f.db.query(
        "select count(*)::int n from grim2_receipts where reference=$1",
        [s.reference],
      )
    ).rows[0].n,
    1,
  );
});
test("repeated verification is idempotent and bypasses Paystack once paid", async () => {
  const s = await start("paid");
  const before = f.stats.verified;
  await f.engine.confirm({
    reference: s.reference,
    customerId: "customer-paid",
  });
  assert.equal(f.stats.verified, before);
});
test("cross-account verification is denied before contacting Paystack", async () => {
  const s = await start("owner"),
    before = f.stats.verified;
  await assert.rejects(
    f.engine.confirm({ reference: s.reference, customerId: "other" }),
    /not found/,
  );
  assert.equal(f.stats.verified, before);
});
test("pending verification does not record a paid order", async () => {
  f.setStatus("pending");
  const s = await start("pending");
  assert.equal(
    (
      await f.engine.confirm({
        reference: s.reference,
        customerId: "customer-pending",
      })
    ).status,
    "pending",
  );
  f.setStatus("success");
});
test("live transaction in Preview is rejected", async () => {
  f.setMismatch({ domain: "live" });
  const s = await start("live");
  await assert.rejects(
    f.engine.confirm({ reference: s.reference, customerId: "customer-live" }),
    /do not pay again/i,
  );
  f.setMismatch({});
});
test("uncertain initialization retains reference without retrying provider", async () => {
  f.setFailure(true);
  const before = f.stats.initialized,
    s = await start("unknown");
  assert.equal(s.status, "initialization_unknown");
  await start("unknown");
  assert.equal(f.stats.initialized - before, 1);
  f.setFailure(false);
});
test("payment recovery succeeds after database finalization failure", async () => {
  const s = await start("recover");
  f.setMismatch({ id: 777 });
  const original = f.store.complete;
  f.store.complete = async () => {
    throw Error("DB unreachable");
  };
  const r = await f.engine.confirm({
    reference: s.reference,
    customerId: "customer-recover",
  });
  assert.equal(r.status, "reconciliation_required");
  f.store.complete = original;
  assert.equal(
    (
      await f.engine.confirm({
        reference: s.reference,
        customerId: "customer-recover",
      })
    ).status,
    "paid",
  );
  f.setMismatch({});
});
test("one Paystack transaction cannot pay two orders", async () => {
  const s = await start("duplicateprovider");
  const r = await f.engine.confirm({
    reference: s.reference,
    customerId: "customer-duplicateprovider",
  });
  assert.equal(r.status, "reconciliation_required");
  assert.equal(
    (
      await f.db.query(
        "select count(*)::int n from grim2_receipts where reference=$1",
        [s.reference],
      )
    ).rows[0].n,
    0,
  );
});
test("wallet debit, receipt and ledger commit once under retries", async () => {
  await f.db.query(
    "insert into grim2_wallet_accounts(customer_id,balance_kobo) values ($1,5000000)",
    ["customer-wallet"],
  );
  const r = await start("wallet", { method: "wallet" });
  assert.equal(r.status, "paid");
  await start("wallet", { method: "wallet" });
  assert.equal((await f.store.wallet("customer-wallet")).balanceKobo, 3200000);
  assert.equal(
    (
      await f.db.query(
        "select count(*)::int n from grim2_wallet_ledger where reference=$1",
        [r.reference],
      )
    ).rows[0].n,
    1,
  );
});
test("insufficient wallet balance rolls back order and debit", async () => {
  await assert.rejects(start("poor", { method: "wallet" }), /insufficient/i);
  assert.equal(
    (
      await f.db.query(
        "select count(*)::int n from grim2_receipts where customer_id='customer-poor'",
      )
    ).rows[0].n,
    0,
  );
});
test("inactive test wallet cannot debit", async () => {
  await f.db.query(
    "insert into grim2_wallet_accounts(customer_id,balance_kobo,active) values ($1,5000000,false)",
    ["customer-inactive"],
  );
  await assert.rejects(start("inactive", { method: "wallet" }), /unavailable/i);
  assert.equal(
    (await f.store.wallet("customer-inactive")).balanceKobo,
    5000000,
  );
});
test("saved billing addresses are scoped to customer", async () => {
  const a = { country: "NG", address: "Test", city: "Test", state: "Test" };
  await f.store.saveAddress("customer-wallet", a);
  await f.store.saveAddress("customer-wallet", a);
  assert.equal((await f.store.addresses("customer-wallet")).length, 1);
  assert.deepEqual(await f.store.addresses("other"), []);
});
test("anon and authenticated roles cannot mutate or finalize orders", async () => {
  for (const role of ["anon", "authenticated"]) {
    await f.db.exec(`set role ${role}`);
    try {
      await assert.rejects(
        f.db.query("select public.grim2_finish_card($1,$2)", ["ref", "1"]),
        /permission denied/,
      );
      await assert.rejects(
        f.db.query("select * from public.grim2_receipts"),
        /permission denied/,
      );
    } finally {
      await f.db.exec("reset role");
    }
  }
});

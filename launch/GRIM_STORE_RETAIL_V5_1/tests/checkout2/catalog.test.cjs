const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createCatalogAdapter,
} = require("../../src/checkout2/grim-catalog-adapter.cjs");
const adapter = createCatalogAdapter(async () => [
  { id: 1, price: 18000, active: 1 },
  { id: 2, price: 20000, active: 0 },
]);
test("authoritative NGN prices become kobo", async () => {
  assert.equal(
    (await adapter([{ productId: "1", quantity: 2 }]))["1"].priceKobo,
    1800000,
  );
});
test("rejects unavailable products", async () => {
  await assert.rejects(adapter([{ productId: "2", quantity: 1 }]));
});
test("rejects client-supplied nonnumeric ids", async () => {
  await assert.rejects(adapter([{ productId: "__proto__", quantity: 1 }]));
});
test("rejects missing product", async () => {
  await assert.rejects(adapter([{ productId: "99", quantity: 1 }]));
});

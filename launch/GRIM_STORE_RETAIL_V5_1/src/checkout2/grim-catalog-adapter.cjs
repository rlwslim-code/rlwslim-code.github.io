"use strict";
// Adapter to GRIM's authoritative product cache; never trust client prices.
function createCatalogAdapter(refreshProductCache) {
  if (typeof refreshProductCache !== "function")
    throw Error("Product cache reader required");
  return async function catalog(lines) {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100)
      throw Error("Invalid cart");
    const products = await refreshProductCache(true);
    if (!Array.isArray(products)) throw Error("Catalog unavailable");
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const result = Object.create(null);
    for (const line of lines) {
      const id = String(line?.productId ?? "");
      if (!/^\d+$/.test(id)) throw Error("Invalid product ID");
      const p = byId.get(id);
      if (
        !p ||
        Number(p.active) !== 1 ||
        !Number.isSafeInteger(Number(p.price)) ||
        Number(p.price) <= 0
      )
        throw Error("Product unavailable");
      const kobo = Number(p.price) * 100;
      if (!Number.isSafeInteger(kobo)) throw Error("Invalid product price");
      result[id] = {
        active: true,
        priceKobo: kobo,
        name: p.name,
        color: p.color,
      };
    }
    return result;
  };
}
module.exports = { createCatalogAdapter };

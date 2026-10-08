"use strict";
const crypto = require("node:crypto");
const {
  buildQuote,
  verifyProvider,
  authorizationOK,
  address,
  contact,
  CheckoutError,
} = require("./checkout-core.cjs");
const refOK = (x) =>
  typeof x === "string" &&
  /^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    x,
  );
const keyOK = (x) => typeof x === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(x);
function createEngine({
  catalog,
  store,
  provider,
  callbackBase,
  shippingKobo = 0,
}) {
  const view = (row) => ({
    reference: row.reference,
    status: row.status,
    method: row.method,
    quote: row.quote,
    authorizationUrl: row.authorization_url || null,
    orderId: row.order_id || null,
  });
  async function quote(lines) {
    return buildQuote({ lines, catalog: await catalog(lines), shippingKobo });
  }
  async function owned(reference, customerId) {
    if (!refOK(reference))
      throw new CheckoutError(
        "INVALID_REFERENCE",
        "Invalid payment reference.",
      );
    const row = await store.get(reference);
    if (!row || (customerId !== null && row.customer_id !== String(customerId)))
      throw new CheckoutError("NOT_FOUND", "Checkout not found.", 404);
    return row;
  }
  async function start(input) {
    const { customerId, email, lines, key, method = "card" } = input;
    if (
      !customerId ||
      typeof email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254
    )
      throw new CheckoutError("INVALID_CUSTOMER", "Sign in to continue.", 401);
    if (!keyOK(key) || !["card", "wallet"].includes(method))
      throw new CheckoutError("INVALID_REQUEST", "Invalid checkout request.");
    // Resolve retries before repricing: a price change must not conceal an existing payment.
    const existing = await store.byKey(String(customerId), key);
    let row = existing;
    if (!row) {
      const priced = await quote(lines),
        shipping = address(input.shipping),
        billing = address(input.billing || input.shipping),
        person = contact(input.contact);
      if(input.expectedTotalKobo !== priced.totalKobo)throw new CheckoutError('PRICE_CHANGED','Your bag total changed. Review the updated total before paying.',409);
      row = await store.create({
        reference: `GRIM2-${crypto.randomUUID()}`,
        customerId: String(customerId),
        email: email.toLowerCase(),
        key,
        method,
        quote: priced,
        shipping,
        billing,
        contact: person,
      });
    }
    if (row.method === "wallet") return wallet(row);
    if (row.status === "paid" || row.authorization_url) return view(row);
    if (!(await store.claim(row.reference)))
      return view(await store.get(row.reference));
    try {
      const payment = await provider.initialize({
        reference: row.reference,
        email: row.email,
        amount: row.quote.totalKobo,
        currency: "NGN",
        callback_url: `${callbackBase}/checkout2.html?reference=${encodeURIComponent(row.reference)}`,
        channels: ["card"],
        metadata: {
          grim_checkout2: true,
          cancel_action: `${callbackBase}/checkout2.html?reference=${encodeURIComponent(row.reference)}`,
        },
      });
      if (!authorizationOK(payment?.authorization_url))
        throw Error("Invalid authorization URL");
      await store.initialized(row.reference, payment.authorization_url);
      return view({
        ...row,
        status: "pending",
        authorization_url: payment.authorization_url,
      });
    } catch {
      await store.flag(row.reference, "initialization_unknown").catch(() => {});
      return {
        ...view(row),
        status: "initialization_unknown",
        message:
          "Payment could not be opened. Check this reference before starting another payment.",
      };
    }
  }
  async function wallet(row) {
    if (row.status === "paid") return view(row);
    try {
      return view(await store.completeWallet(row.reference));
    } catch (e) {
      if (/insufficient|frozen|inactive/i.test(e.message))
        throw new CheckoutError(
          "WALLET_UNAVAILABLE",
          "Your test wallet has insufficient funds or is unavailable.",
          409,
        );
      throw e;
    }
  }
  async function reconcile(reference, customerId = null) {
    const row = await owned(reference, customerId);
    if (row.status === "paid" || row.method === "wallet") return view(row);
    const payment = await provider.verify(reference);
    verifyProvider({
      expected: { reference, email: row.email, totalKobo: row.quote.totalKobo },
      provider: payment,
    });
    if (payment.status !== "success")
      return {
        ...view(row),
        status: payment.status === "failed" ? "failed" : "pending",
        providerStatus: String(payment.status || "unknown"),
      };
    try {
      return view(
        await store.complete({ reference, providerId: String(payment.id) }),
      );
    } catch {
      await store.flag(reference, "reconciliation_required").catch(() => {});
      return {
        ...view(row),
        status: "reconciliation_required",
        message:
          "Payment confirmed. Order recording is pending. Do not pay again.",
      };
    }
  }
  return {
    start,
    quote,
    confirm: ({ reference, customerId }) => reconcile(reference, customerId),
    reconcile,
    view,
  };
}
module.exports = { createEngine, refOK, keyOK };

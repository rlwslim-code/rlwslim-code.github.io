"use strict";
const crypto = require("node:crypto");
class CheckoutError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const money = (n) => Number.isSafeInteger(n) && n >= 0;
function text(value, label, max, optional = false) {
  const v = typeof value === "string" ? value.trim() : "";
  if ((!optional && !v) || v.length > max || /[\x00-\x1f\x7f]/.test(v))
    throw new CheckoutError("INVALID_DETAILS", `Enter a valid ${label}.`);
  return v;
}
function address(v = {}) {
  const country = text(v.country, "country", 2).toUpperCase();
  if (!["NG", "US", "GB", "CA", "GH", "ZA", "KE", "AE"].includes(country))
    throw new CheckoutError(
      "INVALID_DETAILS",
      "Select a supported delivery country.",
    );
  return {
    country,
    address: text(v.address, "street address", 250),
    apartment: text(v.apartment, "apartment", 100, true),
    city: text(v.city, "city", 100),
    state: text(v.state, "state", 100),
    postal: text(v.postal, "postal code", 30, true),
  };
}
function contact(v = {}) {
  return {
    firstName: text(v.firstName, "first name", 80),
    lastName: text(v.lastName, "last name", 80),
    phone: text(v.phone, "phone number", 40),
  };
}
function buildQuote({ lines, catalog, shippingKobo = 0, currency = "NGN" }) {
  if (
    currency !== "NGN" ||
    !money(shippingKobo) ||
    !Array.isArray(lines) ||
    !lines.length ||
    lines.length > 100
  )
    throw new CheckoutError("INVALID_CART", "Review your bag.");
  const seen = new Set();
  let subtotalKobo = 0;
  const items = lines.map((line) => {
    const { productId, quantity, size = "M" } = line || {};
    if (
      typeof productId !== "string" ||
      !/^\d+$/.test(productId) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 10 ||
      !["S", "M", "L", "XL", "XXL"].includes(size) ||
      seen.has(`${productId}:${size}`)
    )
      throw new CheckoutError(
        "INVALID_ITEM",
        "Invalid product, size, or quantity.",
      );
    seen.add(`${productId}:${size}`);
    const p = Object.hasOwn(catalog, productId) ? catalog[productId] : null;
    if (!p || p.active !== true || !money(p.priceKobo) || p.priceKobo === 0)
      throw new CheckoutError(
        "UNAVAILABLE_ITEM",
        "A product is no longer available.",
      );
    const lineKobo = p.priceKobo * quantity;
    subtotalKobo += lineKobo;
    if (!Number.isSafeInteger(subtotalKobo))
      throw new CheckoutError("OVERFLOW", "Order amount is too large.");
    return {
      productId,
      name: String(p.name || productId),
      color: String(p.color || ""),
      size,
      quantity,
      unitKobo: p.priceKobo,
      lineKobo,
    };
  });
  const totalKobo = subtotalKobo + shippingKobo;
  if (!Number.isSafeInteger(totalKobo) || totalKobo < 1)
    throw new CheckoutError("INVALID_TOTAL", "Invalid order amount.");
  return { currency, items, subtotalKobo, shippingKobo, totalKobo };
}
// Compare the merchant's expected amount, never a browser-supplied total.
// On fee-passed transactions Paystack may charge extra, but the original
// requested_amount MUST still match. Do not accept an arbitrary overpayment.
function verifyProvider({ expected, provider, mode = "test" }) {
  const amount = provider?.amount;
  const base = expected?.totalKobo;
  const amountOK = Number.isSafeInteger(base) && base > 0 &&
    Number.isSafeInteger(amount) &&
    ((amount === base && (provider.requested_amount == null || provider.requested_amount === base)) || (
      Number.isSafeInteger(provider?.requested_amount) &&
      Number.isSafeInteger(provider?.fees) &&
      provider.requested_amount === base &&
      provider.fees > 0 &&
      amount === provider.requested_amount + provider.fees
    ));
  if (!provider || (mode !== "test" && mode !== "live") ||
      provider.domain !== mode || provider.currency !== "NGN" ||
      provider.reference !== expected?.reference || !amountOK ||
      !/^[0-9]+$/.test(String(provider.id ?? "")) ||
      (provider.status !== "success" && provider.status !== "failed" &&
       provider.status !== "pending" && provider.status !== "abandoned" &&
       provider.status !== "ongoing" && provider.status !== "processing" &&
       provider.status !== "reversed" && provider.status !== "queued"))
    throw new CheckoutError("PAYMENT_MISMATCH",
      "Payment details do not match. Do not pay again.", 409);
  if (String(provider.customer?.email || "").trim().toLowerCase() !==
      String(expected.email || "").trim().toLowerCase())
    throw new CheckoutError("CUSTOMER_MISMATCH",
      "Payment account does not match. Do not pay again.", 409);
  return { reference: expected.reference, totalKobo: base, providerId: String(provider.id),
    evidence: {domain: provider.domain, status: provider.status, reference: provider.reference, currency: provider.currency,
      requestedAmountKobo: provider.requested_amount ?? null, chargedAmountKobo: amount, providerFeesKobo: provider.fees ?? null,
      processingFeeKobo: amount - base, receiptNumber: provider.receipt_number || null, paidAt: provider.paid_at || null} };
}
function paystackSignatureIsValid(raw, signature, secret, mode = "test") {
  if (!Buffer.isBuffer(raw) || typeof signature !== "string" ||
      !/^[a-f0-9]{128}$/i.test(signature) ||
      !["test", "live"].includes(mode) ||
      !new RegExp(`^sk_${mode}_[A-Za-z0-9]+$`).test(secret || "")) return false;
  return crypto.timingSafeEqual(
    crypto.createHmac("sha512", secret).update(raw).digest(),
    Buffer.from(signature, "hex"),
  );
}
function authorizationOK(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "checkout.paystack.com" &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
module.exports = {
  CheckoutError,
  buildQuote,
  verifyProvider,
  paystackSignatureIsValid,
  authorizationOK,
  address,
  contact,
};

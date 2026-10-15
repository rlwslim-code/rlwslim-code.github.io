'use strict';
// Server-side shipping quote claims. No shipment booking, no payment capture.
const crypto = require('node:crypto');
class ShippingSelectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function positiveSafeInteger(n) { return Number.isSafeInteger(n) && n > 0; }
function createShippingSelection({ secret, now = () => Date.now(), ttlMs = 10 * 60 * 1000 }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new ShippingSelectionError('SHIPPING_NOT_CONFIGURED');
  if (!positiveSafeInteger(ttlMs) || ttlMs > 15 * 60 * 1000) throw new ShippingSelectionError('INVALID_TTL');
  const mac = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  function sign({ customerId, destinationCode, cartFingerprint, requestToken, courier }) {
    if (!customerId || !positiveSafeInteger(destinationCode) || !cartFingerprint ||
        !requestToken || !courier || !positiveSafeInteger(courier.amountKobo) ||
        typeof courier.courierId !== 'string' && typeof courier.courierId !== 'number') {
      throw new ShippingSelectionError('INVALID_SHIPPING_QUOTE');
    }
    const value = Buffer.from(JSON.stringify({
      v: 1, customerId: String(customerId), destinationCode, cartFingerprint,
      requestToken, courierId: String(courier.courierId),
      serviceCode: String(courier.serviceCode || ''), amountKobo: courier.amountKobo,
      exp: now() + ttlMs
    })).toString('base64url');
    return `${value}.${mac(value)}`;
  }
  function verify(token, { customerId, destinationCode, cartFingerprint }) {
    if (typeof token !== 'string' || token.length > 5000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
      throw new ShippingSelectionError('INVALID_SHIPPING_TOKEN');
    const [value, signature] = token.split('.');
    const expected = mac(value);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ShippingSelectionError('INVALID_SHIPPING_TOKEN');
    let claim;
    try { claim = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
    catch { throw new ShippingSelectionError('INVALID_SHIPPING_TOKEN'); }
    if (claim.v !== 1 || claim.customerId !== String(customerId) ||
        (destinationCode !== undefined && claim.destinationCode !== destinationCode) || claim.cartFingerprint !== cartFingerprint ||
        !positiveSafeInteger(claim.amountKobo) || !Number.isSafeInteger(claim.exp) || now() >= claim.exp)
      throw new ShippingSelectionError('SHIPPING_QUOTE_EXPIRED_OR_CHANGED');
    return claim;
  }
  return { sign, verify };
}
module.exports = { createShippingSelection, ShippingSelectionError };

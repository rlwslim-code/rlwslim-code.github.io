'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aa = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(aa, bb);
}

function isValidSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const endpoint = value.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 4096) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return false;
  for (const key of ['auth', 'p256dh']) {
    if (typeof value.keys?.[key] !== 'string' || !/^[A-Za-z0-9_-]{10,256}$/.test(value.keys[key])) return false;
  }
  return true;
}

function originMatches(req) {
  const origin = req.get('origin');
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); }
  catch { return false; }
}

function adminAuthenticated(req) {
  // GRIM's historical Express session guard. Replace through options.adminGuard
  // only if the production admin authentication has changed.
  return req.session?.admin === true;
}

function toPushPayload(event) {
  const allowed = { order_created: 'New GRIM order', payment_received: 'GRIM payment received' };
  const type = String(event.event_type || '');
  return {
    title: allowed[type] || 'GRIM Admin update',
    body: String(event.message || 'Open GRIM Admin to review.').slice(0, 150),
    url: '/grim-admin/#orders',
    tag: `grim-${event.id || type}`.slice(0, 120),
  };
}

module.exports = { safeEqual, isValidSubscription, originMatches, adminAuthenticated, toPushPayload };

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeEqual, isValidSubscription, originMatches, adminAuthenticated, toPushPayload } = require('../src/grim-notify/core.cjs');

const valid = { endpoint: 'https://example.pushservice.com/abc', keys: { p256dh: 'A'.repeat(87), auth: 'b'.repeat(22) } };

test('constant-time token comparison rejects empties and mismatches', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'other'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'secret'), false);
});
test('validates push subscription keys and HTTPS', () => {
  assert.equal(isValidSubscription(valid), true);
  assert.equal(isValidSubscription({ ...valid, endpoint: 'http://example.com' }), false);
  assert.equal(isValidSubscription({ ...valid, keys: { auth: 'x', p256dh: 'x' } }), false);
  assert.equal(isValidSubscription({ ...valid, endpoint: 'https://x:y@example.com' }), false);
});
test('admin access requires an authenticated admin session', () => {
  assert.equal(adminAuthenticated({ session: { admin: true } }), true);
  assert.equal(adminAuthenticated({ session: { admin: false } }), false);
  assert.equal(adminAuthenticated({}), false);
});
test('blocks cross-origin admin mutations', () => {
  const make = origin => ({ get: key => ({ origin, host: 'www.grimwear.store' })[key] });
  assert.equal(originMatches(make('https://www.grimwear.store')), true);
  assert.equal(originMatches(make('https://attacker.example')), false);
  assert.equal(originMatches(make(undefined)), false);
});
test('push payload never exposes customer data', () => {
  const result = toPushPayload({ id:'evt1', event_type:'order_created', message:'New order placed' });
  assert.deepEqual(result, { title: 'New GRIM order', body:'New order placed', url:'/grim-admin/#orders', tag:'grim-evt1' });
});

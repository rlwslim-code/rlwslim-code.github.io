'use strict';

const { safeEqual, isValidSubscription, originMatches, adminAuthenticated, toPushPayload } = require('./core.cjs');
const db = require('./db.cjs');

function configuredWebPush() {
  const webpush = require('web-push');
  const publicKey = process.env.GRIM_NOTIFY_VAPID_PUBLIC_KEY;
  const privateKey = process.env.GRIM_NOTIFY_VAPID_PRIVATE_KEY;
  const subject = process.env.GRIM_NOTIFY_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject || !/^mailto:|^https:\/\//.test(subject)) {
    throw new Error('GRIM Web Push VAPID configuration is incomplete');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return webpush;
}

async function sendPush(push, payload, onlyEndpoint) {
  const subs = await db.listSubscriptions();
  const targets = subs.filter(s => !onlyEndpoint || s.endpoint === onlyEndpoint);
  let ok = 0;
  const problems = [];
  for (const sub of targets) {
    try {
      await push.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      if ([404, 410].includes(Number(e.statusCode))) await db.deleteSubscription(sub.endpoint);
      else problems.push(String(e.message || 'push error').slice(0, 100));
    }
  }
  return { ok, total: targets.length, problems };
}

async function sendEmail(event) {
  const token = process.env.RESEND_API_KEY;
  const to = process.env.GRIM_NOTIFY_EMAIL_TO;
  const from = process.env.GRIM_NOTIFY_EMAIL_FROM;
  if (!token || !to || !from) return false;
  const subject = event.event_type === 'payment_received' ? 'GRIM: Payment received' : 'GRIM: New order';
  const order = String(event.order_id || '').replace(/[^\w-]/g, '').slice(-12);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': `grim-alert-${event.id}` },
    body: JSON.stringify({ from, to: [to], subject, text: `${subject}\nOrder: ${order}\nOpen your secure GRIM admin dashboard to review.\nhttps://www.grimwear.store/grim-admin/#orders` }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Email API HTTP ${response.status}`);
  return true;
}

async function dispatchEvents() {
  const push = configuredWebPush();
  const events = await db.claimEvents();
  let delivered = 0;
  for (const event of events || []) {
    try {
      const pushResult = await sendPush(push, toPushPayload(event));
      let emailOk = false;
      let emailError = '';
      try { emailOk = await sendEmail(event); }
      catch (e) { emailError = String(e.message || e); }
      const succeeded = pushResult.ok > 0 || emailOk;
      await db.finishEvent(event.id, { delivered: succeeded, error: [emailError, ...pushResult.problems].filter(Boolean).join('; ') || 'No active notification channel' });
      if (succeeded) delivered++;
    } catch (e) {
      await db.finishEvent(event.id, { delivered: false, error: e.message });
    }
  }
  return { checked: (events || []).length, delivered };
}

function createAdminRouter(options = {}) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use((req, res, next) => {
    const isAdmin = options.adminGuard ? options.adminGuard(req) : adminAuthenticated(req);
    if (!isAdmin) return res.status(401).json({ error: 'ADMIN_REQUIRED' });
    if (req.method !== 'GET' && !originMatches(req)) return res.status(403).json({ error: 'ORIGIN_REJECTED' });
    next();
  });
  router.get('/config', (_req, res) => {
    const key = process.env.GRIM_NOTIFY_VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: 'NOT_CONFIGURED' });
    res.json({ publicKey: key });
  });
  router.post('/subscribe', async (req, res) => {
    if (!isValidSubscription(req.body?.subscription)) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
    try {
      await db.upsertSubscription(req.body.subscription, req.get('user-agent'));
      res.status(201).json({ ok: true });
    } catch (e) { console.error('[GRIM subscribe]', e); res.status(500).json({ error: 'SUBSCRIBE_FAILED' }); }
  });
  router.post('/unsubscribe', async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 4096) return res.status(400).json({ error: 'INVALID_ENDPOINT' });
    try { await db.deleteSubscription(endpoint); res.json({ ok: true }); }
    catch (e) { console.error('[GRIM unsubscribe]', e); res.status(500).json({ error: 'UNSUBSCRIBE_FAILED' }); }
  });
  router.post('/test', async (req, res) => {
    if (typeof req.body?.endpoint !== 'string') return res.status(400).json({ error: 'INVALID_ENDPOINT' });
    try {
      const result = await sendPush(configuredWebPush(), { title: 'GRIM test notification', body: 'Your order alerts are connected.', url: '/grim-admin/#orders', tag: `grim-test-${Date.now()}` }, req.body.endpoint);
      res.json({ ok: result.ok > 0, sent: result.ok, subscriptions: result.total });
    } catch (e) { console.error('[GRIM test]', e); res.status(500).json({ error: 'TEST_FAILED' }); }
  });
  return router;
}

async function dispatchHandler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const webhookSecret = process.env.GRIM_NOTIFY_WEBHOOK_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.get('x-grim-notify-token');
  const cron = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!(safeEqual(provided, webhookSecret) || (req.method === 'GET' && safeEqual(cron, cronSecret)))) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  try { res.json(await dispatchEvents()); }
  catch (e) { console.error('[GRIM dispatch]', e); res.status(500).json({ error: 'DISPATCH_FAILED' }); }
}

module.exports = { createAdminRouter, dispatchHandler, dispatchEvents };

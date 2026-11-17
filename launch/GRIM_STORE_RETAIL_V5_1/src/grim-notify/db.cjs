'use strict';

function getConfig() {
  const url = process.env.SUPABASE_URL || process.env.GRIM_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server');
  const origin = new URL(url);
  if (origin.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS');
  return { url: origin.origin, key };
}

async function request(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GRIM notification database HTTP ${response.status}: ${text.slice(0, 320)}`);
  return text ? JSON.parse(text) : null;
}

async function upsertSubscription(subscription, userAgent) {
  return request('grim_notify_push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { endpoint: subscription.endpoint, subscription, user_agent: String(userAgent || '').slice(0, 300), updated_at: new Date().toISOString() },
  });
}

async function deleteSubscription(endpoint) {
  return request(`grim_notify_push_subscriptions?${new URLSearchParams({ endpoint: `eq.${endpoint}` })}`, { method: 'DELETE' });
}

async function listSubscriptions() {
  return request('grim_notify_push_subscriptions?select=endpoint,subscription&limit=200');
}

async function claimEvents() {
  return request('rpc/grim_notify_claim_events', { method: 'POST', body: { batch_size: 20 } });
}

async function finishEvent(id, { delivered, error } = {}) {
  const now = new Date();
  const next = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  return request(`grim_notify_outbox?${new URLSearchParams({ id: `eq.${id}` })}`, {
    method: 'PATCH',
    body: {
      lease_until: null,
      ...(delivered ? { delivered_at: now.toISOString(), last_error: null } : { available_at: next, last_error: String(error || 'delivery failed').slice(0, 500) }),
    },
  });
}

module.exports = { request, upsertSubscription, deleteSubscription, listSubscriptions, claimEvents, finishEvent };

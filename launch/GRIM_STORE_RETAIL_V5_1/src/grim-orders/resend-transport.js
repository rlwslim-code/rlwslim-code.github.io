// Additive Resend transport. No checkout/payment mutation.
export function resendConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.GRIM_EMAIL_FROM);
}

export async function sendGrimEmail({ to, subject, html, text, idempotencyKey }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!resendConfigured(env)) throw new Error('RESEND_NOT_CONFIGURED');
  if (!/^\S+@\S+\.\S+$/.test(String(to || ''))) throw new Error('INVALID_RECIPIENT');
  if (!idempotencyKey || !/^[a-zA-Z0-9:_-]{1,180}$/.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ from: env.GRIM_EMAIL_FROM, to: [to], subject, html, text })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(`RESEND_SEND_FAILED_${response.status}`);
  return { provider: 'resend', messageId: result.id };
}

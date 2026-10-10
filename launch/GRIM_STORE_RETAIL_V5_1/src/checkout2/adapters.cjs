"use strict";
function createPaystack(secret, fetcher = fetch, mode = "test") {
  if (!["test", "live"].includes(mode) ||
      !new RegExp(`^sk_${mode}_[A-Za-z0-9]+$`).test(secret || ""))
    throw Error(`Dedicated Paystack ${mode} key required`);
  async function call(path, method = "GET", body) {
    const res = await fetcher(`https://api.paystack.co${path}`, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Paystack transaction IDs are unsigned 64-bit values; preserve their exact decimal digits.
    const json = typeof res.text === 'function'
      ? JSON.parse((await res.text()).replace(/("id"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'))
      : await res.json();
    if (!res.ok || json.status !== true || !json.data)
      throw Error(
        "Paystack could not confirm this request. Check the existing reference.",
      );
    return json.data;
  }
  return {
    initialize: (payload) => call("/transaction/initialize", "POST", payload),
    verify: (reference) =>
      call(`/transaction/verify/${encodeURIComponent(reference)}`),
  };
}
function createSupabaseStore({ url, serviceKey, fetcher = fetch, mode = "test" }) {
  if (!url || !serviceKey)
    throw Error("Isolated Supabase server configuration required");
  async function rpc(name, payload = {}) {
    const res = await fetcher(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const err = new Error(
        /insufficient|frozen|inactive/i.test(e.message || "")
          ? "insufficient or inactive wallet"
          : "Checkout database request failed",
      );
      err.code = e.code;
      throw err;
    }
    return res.json();
  }
  return {
    health: () => rpc(mode === "live" ? "grim2_health_live" : "grim2_health"),
    create: (r) =>
      rpc("grim2_start", {
        p_reference: r.reference,
        p_customer: r.customerId,
        p_email: r.email,
        p_key: r.key,
        p_method: r.method,
        p_quote: r.quote,
        p_shipping: r.shipping,
        p_billing: r.billing,
        p_contact: r.contact,
      }),
    byKey: (customer, key) =>
      rpc("grim2_by_key", { p_customer: customer, p_key: key }),
    get: (reference) => rpc("grim2_read", { p_reference: reference }),
    claim: (reference) => rpc("grim2_claim", { p_reference: reference }),
    initialized: (reference, url) =>
      rpc("grim2_initialized", { p_reference: reference, p_url: url }),
    complete: ({ reference, providerId, evidence }) =>
      rpc(evidence ? (mode === "live" ? "grim2_finish_card_live_verified" : "grim2_finish_card_verified") : (mode === "live" ? "grim2_finish_card_live" : "grim2_finish_card"), {
        p_reference: reference,
        p_provider: providerId,
        ...(evidence ? {p_evidence: evidence} : {}),
      }),
    completeWallet: (reference) =>
      rpc(mode === "live" ? "grim2_finish_wallet_live" : "grim2_finish_wallet", { p_reference: reference }),
    flag: (reference, status) =>
      rpc("grim2_flag", { p_reference: reference, p_status: status }),
    cancelWallet: (reference) => rpc("grim2_cancel_wallet", {p_reference: reference}),
    pending: (customer) => rpc("grim2_pending", { p_customer: customer }),
    wallet: (customer) => rpc(mode === "live" ? "grim2_wallet_live" : "grim2_wallet", { p_customer: customer }),
    addresses: (customer) => rpc("grim2_addresses", { p_customer: customer }),
    saveAddress: (customer, billing) =>
      rpc("grim2_save_address", { p_customer: customer, p_address: billing }),
  };
}
module.exports = { createPaystack, createSupabaseStore };

"use strict";
// Fail closed. A Preview can only use TEST funds; production requires several
// independent, explicitly set gates and the existing LIVE database.
function previewConfig(env = process.env) {
  const preview = env.VERCEL_ENV === "preview";
  const local = env.GRIM_CHECKOUT2_LOCAL === "true" && !env.VERCEL && env.NODE_ENV !== "production";
  const production = env.VERCEL_ENV === "production";
  const mode = production ? "live" : "test";
  const enabled = production ? env.GRIM_CHECKOUT2_LIVE_ENABLED === "true" :
    env.GRIM_CHECKOUT2_ENABLED === "true";
  const blockers = [];
  if (!enabled) blockers.push("Checkout 2.0 is disabled.");
  if (!preview && !local && !production)
    blockers.push("Checkout environment is unsupported.");
  let secret, url, serviceKey, base, walletEnabled = false;
  let shippingKobo = 0;
  if (production) {
    secret = env.GRIM_CHECKOUT2_LIVE_PAYSTACK_SECRET_KEY;
    url = env.SUPABASE_URL;
    serviceKey = env.SUPABASE_SECRET_KEY;
    walletEnabled = env.GRIM_CHECKOUT2_LIVE_WALLET_ENABLED === "true";
    if (env.GRIM_CHECKOUT2_PROD_DB_CONFIRMED !== "true")
      blockers.push("Production checkout database migration is not confirmed.");
    if (!/^sk_live_[A-Za-z0-9]+$/.test(secret || ""))
      blockers.push("A Paystack LIVE secret is required.");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || "") ||
        !serviceKey)
      blockers.push("Production GRIM database credentials are unavailable.");
    const origin = env.GRIM_CHECKOUT2_PUBLIC_ORIGIN || "";
    if (!["https://www.grimwear.store", "https://grimwear.store"].includes(origin))
      blockers.push("An approved GRIM live checkout origin is required.");
    base = origin;
  } else {
    secret = env.GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY;
    url = env.GRIM_CHECKOUT2_SUPABASE_URL;
    serviceKey = env.GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY;
    walletEnabled = true;
    if (!/^sk_test_[A-Za-z0-9]+$/.test(secret || ""))
      blockers.push("A dedicated Paystack test secret is required.");
    if (env.GRIM_CHECKOUT2_DB_ISOLATED !== "true")
      blockers.push("An isolated Supabase test database is required.");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || "") ||
        (env.SUPABASE_URL && url === env.SUPABASE_URL))
      blockers.push("An isolated Supabase test URL is required.");
    if (!serviceKey)
      blockers.push("Test database service-role key is missing.");
    base = preview && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL || "")
      ? `https://${env.VERCEL_URL}` : local ? "http://localhost:3000" : null;
    if (!base) blockers.push("The Preview deployment URL is unavailable.");
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    blockers.push("SESSION_SECRET must contain at least 32 characters.");
  return { enabled, ready: blockers.length === 0, blockers, preview, local,
    production, mode, secret, url, serviceKey, base, walletEnabled, shippingKobo,
    // Bank transfer is a separate explicit opt-in; verify merchant Paystack transfer eligibility first.
    bankTransferEnabled: production && env.GRIM_CHECKOUT2_LIVE_BANK_TRANSFER_ENABLED === 'true',
    // Wallet deductions require an additional explicit gate, disabled by default.
    quoteWalletEnabled: production && walletEnabled && env.GRIM_CHECKOUT2_MANUAL_WALLET_ENABLED === 'true',
    quotePaymentsEnabled: production && env.GRIM_QUOTE_LIVE_PAYMENTS_ENABLED === "true",
    // Merchant opt-in to accepting ALL valid, admin-approved quotations (not only one test UUID).
    // This does not enable Wallet, transfer or unquoted courier payments.
    quoteAllApprovedEnabled: production && env.GRIM_QUOTE_ALL_APPROVED_ENABLED === "true",
    // Offer Card + Bank Transfer within the SAME Paystack hosted checkout.
    // Requires Paystack transfer eligibility; independent from v2 transfer RPC.
    quotePaystackDualChannelEnabled: production && env.GRIM_QUOTE_PAYSTACK_DUAL_CHANNEL_ENABLED === "true",
    // Test-only allowlist: refuse live quote charges unless the matching UUID is set.
    // Do not remove this gate until a real payment and order-recording regression has passed.
    quoteTestId: production && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(env.GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID || "").trim())
      ? String(env.GRIM_CHECKOUT2_LIVE_TEST_QUOTE_ID).trim().toLowerCase() : null,
    shippingRequired: true, acceptNewOrders: production ? env.GRIM_CHECKOUT2_ACCEPT_NEW_ORDERS === "true" : env.GRIM_CHECKOUT2_ACCEPT_NEW_ORDERS !== "false" };
}
module.exports = { previewConfig };

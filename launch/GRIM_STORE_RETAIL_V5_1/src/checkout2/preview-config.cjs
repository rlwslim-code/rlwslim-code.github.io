"use strict";
function previewConfig(env = process.env) {
  const enabled = env.GRIM_CHECKOUT2_ENABLED === "true",
    preview = env.VERCEL_ENV === "preview";
  const local =
    env.GRIM_CHECKOUT2_LOCAL === "true" &&
    !env.VERCEL &&
    env.NODE_ENV !== "production";
  const blockers = [];
  if (!enabled) blockers.push("Checkout 2.0 is disabled.");
  if (!preview && !local)
    blockers.push("Checkout 2.0 requires Vercel Preview.");
  if (
    !/^sk_test_[A-Za-z0-9]+$/.test(env.GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY || "")
  )
    blockers.push("A dedicated Paystack test secret is required.");
  if (env.GRIM_CHECKOUT2_DB_ISOLATED !== "true")
    blockers.push("An isolated Supabase test project must be confirmed.");
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(
      env.GRIM_CHECKOUT2_SUPABASE_URL || "",
    )
  )
    blockers.push("An isolated Supabase test URL is required.");
  if (
    env.GRIM_CHECKOUT2_SUPABASE_URL &&
    env.GRIM_CHECKOUT2_SUPABASE_URL === env.SUPABASE_URL
  )
    blockers.push("Test and production Supabase URLs must differ.");
  if (!env.GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY)
    blockers.push("The test database service-role key is required.");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    blockers.push(
      "A Preview session secret of at least 32 characters is required.",
    );
  const base =
    preview && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL || "")
      ? `https://${env.VERCEL_URL}`
      : local
        ? "http://localhost:3000"
        : null;
  if (!base) blockers.push("The Preview deployment URL is unavailable.");
  return {
    enabled,
    preview,
    local,
    ready: !blockers.length,
    blockers,
    base,
    secret: env.GRIM_CHECKOUT2_PAYSTACK_SECRET_KEY,
    url: env.GRIM_CHECKOUT2_SUPABASE_URL,
    serviceKey: env.GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY,
  };
}
module.exports = { previewConfig };

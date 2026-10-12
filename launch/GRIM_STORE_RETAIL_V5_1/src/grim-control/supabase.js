import { createClient } from "@supabase/supabase-js";

// A Preview never inherits production credentials or accesses customer data there.
const testEnvironment = process.env.VERCEL_ENV === 'preview' ||
  (process.env.GRIM_CHECKOUT2_LOCAL === 'true' && !process.env.VERCEL && process.env.NODE_ENV !== 'production');
const isolated = process.env.GRIM_CHECKOUT2_DB_ISOLATED === 'true' &&
  process.env.GRIM_CHECKOUT2_SUPABASE_URL !== process.env.SUPABASE_URL;
const url = testEnvironment ? (isolated ? process.env.GRIM_CHECKOUT2_SUPABASE_URL : null) : process.env.SUPABASE_URL;
const secret = testEnvironment ? (isolated ? process.env.GRIM_CHECKOUT2_SUPABASE_SERVICE_ROLE_KEY : null) : process.env.SUPABASE_SECRET_KEY;

export const grimSupabase =
  url && secret
    ? createClient(url, secret, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

export function grimSupabaseReady() {
  return Boolean(grimSupabase);
}

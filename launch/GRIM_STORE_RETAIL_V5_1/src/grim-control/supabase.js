import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

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

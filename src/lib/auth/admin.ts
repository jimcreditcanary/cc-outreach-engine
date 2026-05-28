// Admin Supabase client (service-role). For listing / creating users on the
// /admin/users page only. Never expose to the browser.

import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service role key");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

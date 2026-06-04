import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const { data, error } = await db
    .from("sequences")
    .select("id, name, status, auto_send, owner_id, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.error("error:", error); process.exit(1); }
  console.log(`Found ${data?.length ?? 0} sequence(s):`);
  for (const s of data ?? []) {
    console.log(` - ${s.created_at} | "${s.name}" | status=${s.status} auto_send=${s.auto_send} owner=${s.owner_id}`);
  }
})();

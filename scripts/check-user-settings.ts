import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
  const { data: settings } = await db.from("user_settings").select("*");
  const map = new Map<string, Record<string, unknown>>();
  for (const s of settings ?? []) map.set(s.user_id, s);
  for (const u of users?.users ?? []) {
    const s = map.get(u.id);
    console.log(`\n${u.email}  (${u.id})`);
    console.log(`  from_email             : ${s?.from_email ?? "— (will fall back to env POSTMARK_FROM)"}`);
    console.log(`  reply_to_email         : ${s?.reply_to_email ?? "— (will fall back to env POSTMARK_REPLY_TO)"}`);
    console.log(`  postmark_signature_id  : ${s?.postmark_signature_id ?? "—"}`);
    console.log(`  postmark_sig_verified  : ${s?.postmark_signature_verified ?? "—"}`);
  }
  console.log(`\nWorkspace defaults:`);
  console.log(`  POSTMARK_FROM            : ${process.env.POSTMARK_FROM ?? "(unset)"}`);
  console.log(`  POSTMARK_REPLY_TO        : ${process.env.POSTMARK_REPLY_TO ?? "(unset)"}`);
})();

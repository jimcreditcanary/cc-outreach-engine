// One-off diagnostic: how many meetings rows predate owner stamping?
// Under the per-user /meetings scope (owner-or-invited), null-owner rows
// are visible to everyone — fine only if there are none / they're Jim's.
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { count: total } = await db.from("meetings").select("*", { count: "exact", head: true });
  const { count: unowned } = await db.from("meetings").select("*", { count: "exact", head: true }).is("owner_id", null);
  console.log({ total, unowned });
}
main();

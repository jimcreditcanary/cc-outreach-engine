import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
  for (const u of data?.users ?? []) {
    console.log(` - ${u.id}  |  ${u.email}`);
  }
})();

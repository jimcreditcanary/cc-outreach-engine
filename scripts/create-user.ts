// Create an operator user via Supabase Auth admin API.
//   npm run create-user -- email@example.com password123
// Use this for the FIRST user (chicken-and-egg: /admin/users needs you to be
// logged in already). After that, add more users from /admin/users.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", override: true });

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("usage: create-user <email> <password>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Created user ${data.user?.email} (id ${data.user?.id}). Sign in at /login.`);
}

main();

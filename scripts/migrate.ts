// Apply a single SQL migration against SUPABASE_DB_URL.
//
//   npm run migrate -- supabase/migrations/007_contact_mobile.sql
//
// Migrations are NOT idempotent as a set (001 creates tables), so this
// applies exactly the file you name — never the whole folder. Runs inside a
// transaction; rolls back on any error.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true });

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: migrate <path/to/migration.sql>");
    process.exit(1);
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL missing from .env.local");

  const sql = readFileSync(file, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log(`Applied ${file}`);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

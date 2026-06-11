// Same as migrate.ts but routed through the Supabase SESSION POOLER, which
// has an IPv4 address. The direct db.<ref>.supabase.co host is IPv6-only
// and unreachable from IPv4-only networks (getaddrinfo ENOTFOUND) — the
// reason migrations used to be pasted into the SQL editor by hand.
//
//   npm run migrate:pooler -- supabase/migrations/034_google_calendar.sql
//
// Pooler quirks: username must be "postgres.<project-ref>", and we probe a
// few regional hosts because the assigned one isn't recorded anywhere local.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", override: true });

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: migrate-pooler <path/to/migration.sql>");
    process.exit(1);
  }
  const direct = process.env.SUPABASE_DB_URL;
  if (!direct) throw new Error("SUPABASE_DB_URL missing from .env.local");

  const u = new URL(direct);
  const ref = u.hostname.split(".")[1]; // db.<ref>.supabase.co
  // Tenant lives on aws-0-eu-west-1 (probed); try both password readings —
  // raw vs percent-decoded — since the URL may or may not encode specials.
  const attempts = [
    { host: "aws-0-eu-west-1.pooler.supabase.com", password: u.password },
    { host: "aws-0-eu-west-1.pooler.supabase.com", password: decodeURIComponent(u.password) },
  ];

  const sql = readFileSync(file, "utf8");
  for (const { host, password } of attempts) {
    const client = new Client({
      host,
      port: 5432, // session mode (transaction mode 6543 can't run multi-statement DDL reliably)
      user: `postgres.${ref}`,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
    } catch (e) {
      console.error(`✗ ${host}: ${(e as Error).message}`);
      await client.end().catch(() => {});
      continue;
    }
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log(`✓ applied ${file} via ${host}`);
      await client.end();
      return;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      await client.end();
      throw e;
    }
  }
  throw new Error("No pooler host accepted the connection — run the SQL in the Supabase SQL editor instead.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

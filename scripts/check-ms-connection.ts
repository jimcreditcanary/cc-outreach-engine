// Diagnostic: show the connected Microsoft 365 account(s) and whether the stored
// token's granted scope includes Mail.Send (required for Outlook outreach sends).
// Read-only. Prints no tokens.
//
//   npx tsx scripts/check-ms-connection.ts

import { config } from "dotenv";
config({ path: ".env.local", override: true });

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const db = serviceClient();
  const { data, error } = await db
    .from("ms_oauth_tokens")
    .select("user_id, scope, expires_at, updated_at, created_at")
    .order("created_at", { ascending: true });
  if (error) { console.error(error); process.exit(1); }
  const rows = (data ?? []) as { user_id: string; scope: string | null; expires_at: string; updated_at: string; created_at: string }[];
  if (!rows.length) { console.log("No Microsoft 365 accounts connected yet (ms_oauth_tokens is empty)."); return; }

  console.log(`Connected Microsoft 365 account(s): ${rows.length}\n`);
  for (const r of rows) {
    const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
    const hasMailSend = scopes.some((s) => /mail\.send/i.test(s));
    console.log(`user_id: ${r.user_id}`);
    console.log(`  connected: ${r.created_at}  last refresh: ${r.updated_at}`);
    console.log(`  scope: ${r.scope || "(none recorded)"}`);
    console.log(`  Mail.Send granted: ${hasMailSend ? "YES ✓ (Outlook sends will work)" : "NO ✗ — reconnect in Settings to grant it"}`);
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

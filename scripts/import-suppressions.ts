// Import historical do-not-contact / unsubscribes (build brief §13 pre-flight).
//
//   npm run import-suppressions -- ./suppressions.csv [reason]
//
// Tolerant: takes any CSV/xlsx with an email column (Email / email_address /
// e-mail / contact). Default reason = "manual"; pass unsubscribe/complaint/
// hard_bounce to override. Upserts by email.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { parseTabular } from "../src/lib/import/parse";

config({ path: ".env.local", override: true });

const EMAIL_KEYS = ["email", "email_address", "e_mail", "emailaddress", "contact", "primary_email"];
const VALID_REASONS = new Set(["manual", "unsubscribe", "complaint", "hard_bounce"]);

function pickEmail(row: Record<string, unknown>): string | undefined {
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (EMAIL_KEYS.includes(key)) {
      const s = String(v ?? "").trim();
      if (s.includes("@")) return s;
    }
  }
  return undefined;
}

async function main() {
  const [file, reasonArg] = process.argv.slice(2);
  if (!file) {
    console.error("usage: import-suppressions <file.csv|.xlsx> [manual|unsubscribe|complaint|hard_bounce]");
    process.exit(1);
  }
  const reason = reasonArg && VALID_REASONS.has(reasonArg) ? reasonArg : "manual";
  const db = serviceClient();

  const rows = parseTabular(readFileSync(file), file);
  const emails = new Set<string>();
  for (const r of rows) {
    const e = pickEmail(r as Record<string, unknown>);
    if (e) emails.add(e.toLowerCase());
  }
  console.log(`Found ${emails.size} emails (reason=${reason}).`);

  let n = 0;
  for (const email of emails) {
    const { error } = await db.from("suppressions").upsert({ email, reason }, { onConflict: "email" });
    if (error) throw error;
    n++;
  }
  console.log(`Suppressed ${n} addresses.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

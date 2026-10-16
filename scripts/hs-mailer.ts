// HubSpot mailer CLI (P5). Approval-queue-first: queue a campaign, review,
// approve, then send with all guardrails. Dry-run when POSTMARK_SERVER_TOKEN
// is unset (nothing sends). Needs migration 039 (hs_sends) applied.
//
//   npm run hs-mailer -- queue <segment> --campaign=<name> --subject="…" --body=<file.txt> [--cooldown=28] [--cap=2000]
//   npm run hs-mailer -- list [status]
//   npm run hs-mailer -- approve [campaign]
//   npm run hs-mailer -- send [--batch=10] [--force]
//
// <segment>: new_leads | all | source:<lead_source>
// Body/subject support {{first_name}} and {{company}}.

import { config } from "dotenv";
import { readFileSync } from "node:fs";
config({ path: ".env.local", override: true });

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const { serviceClient } = await import("../src/lib/db/client");
  const db = serviceClient();

  if (cmd === "queue") {
    const { queueCampaign } = await import("../src/lib/mailer/queue");
    const { parseSegment, segmentLabel } = await import("../src/lib/mailer/types");
    const segment = parseSegment(arg ?? "");
    const subject = flag("subject");
    const bodyFile = flag("body");
    if (!subject || !bodyFile) { console.error("queue needs --subject and --body=<file>"); process.exit(1); }
    const bodyTemplate = readFileSync(bodyFile, "utf8");
    const campaign = flag("campaign") ?? `${segmentLabel(segment)}-${new Date().toISOString().slice(0, 10)}`;
    const res = await queueCampaign(db, {
      segment, campaign, subject, bodyTemplate,
      cooldownDays: flag("cooldown") ? Number(flag("cooldown")) : undefined,
      cap: flag("cap") ? Number(flag("cap")) : undefined,
    });
    console.log(`Campaign "${campaign}": audience ${res.audience} → queued ${res.queued} (skipped ${res.skippedSuppressed} suppressed, ${res.skippedRecent} recent/dupe)`);
    return;
  }

  if (cmd === "approve") {
    const { approveCampaign } = await import("../src/lib/mailer/queue");
    const n = await approveCampaign(db, arg ?? null);
    console.log(`Approved ${n} queued row(s)${arg ? ` for "${arg}"` : ""}.`);
    return;
  }

  if (cmd === "send") {
    const { runHsSendBatch } = await import("../src/lib/mailer/send");
    const r = await runHsSendBatch(db, { batch: flag("batch") ? Number(flag("batch")) : undefined, force: has("force") });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === "list") {
    const statuses = ["queued", "approved", "sent", "suppressed", "failed", "skipped"];
    for (const st of statuses) {
      const { count } = await db.from("hs_sends").select("*", { count: "exact", head: true }).eq("status", st);
      if ((count ?? 0) > 0) console.log(`  ${st.padEnd(11)} ${count}`);
    }
    if (arg) {
      const { data } = await db.from("hs_sends").select("email, subject, campaign, status, sent_at").eq("status", arg).order("ts", { ascending: false }).limit(20);
      console.log("");
      for (const r of (data ?? []) as { email: string; subject: string | null; campaign: string | null; status: string }[]) {
        console.log(`  • ${r.email} | ${r.campaign ?? "—"} | ${r.subject ?? ""}`);
      }
    }
    return;
  }

  console.error("Usage: queue <segment> | list [status] | approve [campaign] | send");
  process.exit(1);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });

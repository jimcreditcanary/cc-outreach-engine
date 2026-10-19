// Run the outreach workflow for a segment: research + draft each eligible
// contact into the review queue (high-confidence auto-approved, rest queued).
// Then review/approve + send with the existing mailer (npm run hs-mailer).
//
//   npm run workflow -- new_leads --campaign=q4-cu --limit=10
//   npm run workflow -- source:whitepaper --limit=5 --dry
//   npm run workflow -- new_leads --limit=20 --no-auto-send   # queue everything for review
//
// <segment>: new_leads | all | source:<lead_source>

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { runDraftWorkflow } = await import("../src/lib/mailer/workflow");
  const { parseSegment, segmentLabel } = await import("../src/lib/mailer/types");
  const { serpEnabled } = await import("../src/lib/mailer/research");

  const segArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!segArg) { console.error("Usage: workflow <segment> [--campaign=] [--limit=10] [--cooldown=60] [--no-auto-send] [--dry]"); process.exit(1); }
  const segment = parseSegment(segArg);
  if (!serpEnabled()) console.warn("⚠ No SERP key — research will be skipped; drafts personalise on sector/role only.");

  const campaign = flag("campaign") ?? `${segmentLabel(segment)}-${new Date().toISOString().slice(0, 10)}`;
  const db = serviceClient();

  console.log(`Workflow "${campaign}" · segment ${segArg} · limit ${flag("limit") ?? 25}${has("dry") ? " · DRY" : ""}`);
  const res = await runDraftWorkflow(db, {
    segment, campaign,
    limit: flag("limit") ? Number(flag("limit")) : undefined,
    cooldownDays: flag("cooldown") ? Number(flag("cooldown")) : undefined,
    autoSendHigh: !has("no-auto-send"),
    dry: has("dry"),
    onProgress: (m) => console.log(`  ${m}`),
  });

  console.log(`\nAudience ${res.audience} → processed ${res.processed}: ${res.approved} auto-approved, ${res.queued} to review` +
    ` (skipped ${res.skippedSuppressed} suppressed/bounced, ${res.skippedRecent} recent/active, ${res.failed} failed).`);
  console.log(has("dry") ? "Dry run — nothing written." : `Review + send: npm run hs-mailer -- list  /  approve ${campaign}  /  send`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });

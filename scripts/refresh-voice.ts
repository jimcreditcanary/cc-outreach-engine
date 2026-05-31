// Style-learning loop. Distils a REFRESHED voice spec from the live signal
// the system has been accumulating since the original one was generated:
//
//   - last 30 sent drafts          → what passed your bar (and any edits you
//                                    made: original_body_text vs body_text)
//   - last 30 draft_rejections     → what didn't, plus your reason + note
//
//   npm run refresh-voice
//
// Writes back to creditcanary-voice-spec.md. Anonymisation guard backstops
// the roster. Commit the diff if you're happy; revert if you're not.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { generateText } from "../src/lib/ai/claude";
import { checkAnonymisation } from "../src/lib/generate/anonymisation";

config({ path: ".env.local", override: true });

const SPEC_PATH = "creditcanary-voice-spec.md";

interface SentRow {
  subject: string | null;
  body_text: string | null;
  original_body_text: string | null;
  ts: string;
}
interface RejectRow {
  subject: string | null;
  body_text: string | null;
  reason: string;
  note: string | null;
  ts: string;
}

function trimTo(s: string | null | undefined, max: number): string {
  return (s ?? "").trim().slice(0, max);
}

async function main() {
  if (!existsSync(SPEC_PATH)) {
    console.error(`No existing spec at ${SPEC_PATH} — run npm run voice-spec first.`);
    process.exit(1);
  }
  const currentSpec = readFileSync(SPEC_PATH, "utf8");
  const db = serviceClient();

  const [{ data: sent }, { data: rejected }] = await Promise.all([
    db
      .from("sends")
      .select("subject, body_text, original_body_text, ts")
      .eq("status", "sent")
      .order("ts", { ascending: false })
      .limit(30),
    db
      .from("draft_rejections")
      .select("subject, body_text, reason, note, ts")
      .order("ts", { ascending: false })
      .limit(30),
  ]);

  const sentRows = (sent ?? []) as SentRow[];
  const rejectRows = (rejected ?? []) as RejectRow[];

  if (sentRows.length === 0 && rejectRows.length === 0) {
    console.log("No sent emails or rejections yet — nothing to learn from. Run more outreach first.");
    process.exit(0);
  }

  console.log(`Refining voice from ${sentRows.length} sent + ${rejectRows.length} rejected drafts…`);

  // Build the corpus. For sent emails, if the operator edited it, show the
  // diff explicitly (original vs final) — that's the loudest signal.
  const sentCorpus = sentRows
    .map((r, i) => {
      const original = trimTo(r.original_body_text, 2000);
      const final = trimTo(r.body_text, 2000);
      const edited = original && original !== final;
      return [
        `--- SENT #${i + 1} (${r.ts.slice(0, 10)}) ---`,
        `Subject: ${r.subject ?? ""}`,
        edited
          ? `[Operator edited before sending]\nAI ORIGINAL:\n${original}\n\nSENT VERSION:\n${final}`
          : `Body:\n${final}`,
      ].join("\n");
    })
    .join("\n\n");

  const rejectCorpus = rejectRows
    .map((r, i) =>
      [
        `--- REJECTED #${i + 1} (${r.ts.slice(0, 10)}) ---`,
        `Reason: ${r.reason}${r.note ? ` — ${r.note}` : ""}`,
        `Subject: ${r.subject ?? ""}`,
        `Body:\n${trimTo(r.body_text, 1500)}`,
      ].join("\n"),
    )
    .join("\n\n");

  // Tally rejection reasons for a top-of-prompt summary.
  const reasonCounts: Record<string, number> = {};
  for (const r of rejectRows) reasonCounts[r.reason] = (reasonCounts[r.reason] ?? 0) + 1;
  const reasonSummary = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `  ${n}× ${r}`)
    .join("\n");

  const system = `You are refining a voice spec used to draft outreach emails as Jim
Fell (CEO, Credit Canary — a UK credit-decisioning + payments fintech). You
have his CURRENT voice spec, a corpus of recent SENT emails (some edited
before sending — diff shown), and a corpus of REJECTED drafts with the
reason Jim gave for each rejection.

Produce a REFRESHED voice spec in markdown that:
1. Inherits everything still right about the current spec.
2. Sharpens patterns you can observe in the SENT corpus (especially edits —
   what Jim CHANGED is what he wants more of).
3. Tightens the DON'T list using the REJECTION reasons (cluster them — e.g.
   "Too salesy" rejections → strengthen the anti-sales-language rule).
4. Stays abstract — patterns, not instances. NO company names, person
   names, product names, or recipient details. Generic example phrases only.

HARD RULES (do not break):
- Output ONLY the markdown spec. No preamble, no "Here is the refreshed".
- Roster names must NEVER appear: it's a committed artefact.
- Keep it scannable — bullets, short paragraphs, explicit DO and DON'T lists.`;

  const user = `CURRENT VOICE SPEC
==================
${currentSpec}


REJECTION REASON TALLY (most common first)
==========================================
${reasonSummary || "  (no rejections yet)"}


RECENT REJECTED DRAFTS (with Jim's reasons)
============================================
${rejectCorpus || "(none yet)"}


RECENT SENT EMAILS (some show edit diffs — Jim's edits are the strongest signal)
================================================================================
${sentCorpus || "(none yet)"}


Now produce the refreshed voice spec.`;

  const refreshed = await generateText({
    system,
    user,
    effort: "high",
    maxTokens: 8000,
    cacheSystem: false,
  });

  const check = checkAnonymisation(refreshed);
  if (!check.clean) {
    console.error(`Refreshed spec leaked roster names (${check.hits.join(", ")}) — not writing.`);
    process.exit(1);
  }

  const header = `<!-- Refreshed by scripts/refresh-voice.ts on ${new Date().toISOString().slice(0, 10)}.
     Inherits the static voice-spec base + learns from real sends + rejections.
     Abstract patterns only (no client/recipient names). -->\n\n`;
  writeFileSync(SPEC_PATH, header + refreshed.trim() + "\n");
  console.log(`Wrote ${SPEC_PATH} (${refreshed.length} chars). Diff it, commit if happy.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

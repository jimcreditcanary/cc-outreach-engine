// Generation config: the large, stable system prompt (targeting map +
// voice spec + hard rules) that's cached and reused across every draft,
// plus the standard CTA + signature.

import { readFileSync } from "node:fs";

export const SCHEDULER_LINK =
  "https://creditcanary.pipedrive.com/scheduler/Mlm4k3h0/meeting-with-james-fell";

/** Plain-text signature appended to every body_text. */
export const SIGNATURE_TEXT = `Jim

—
Jim Fell
CEO & Co-Founder
Credit Canary
jim@creditcanary.co.uk
See my schedule and book a time here: ${SCHEDULER_LINK}`;

/** Native-looking HTML signature (no template chrome, system font). */
export const SIGNATURE_HTML = `<p>Jim</p>
<p style="color:#666">—<br>
Jim Fell<br>
CEO &amp; Co-Founder, Credit Canary<br>
<a href="mailto:jim@creditcanary.co.uk">jim@creditcanary.co.uk</a><br>
<a href="${SCHEDULER_LINK}">See my schedule and book a time here</a></p>`;

let _system: string | null = null;

/**
 * Build the cached system prompt once per process. Combines the voice spec
 * (how to write) and the targeting map (what to say per sector), then the
 * hard rules and output contract.
 */
export function buildSystemPrompt(): string {
  if (_system) return _system;

  const voiceSpec = readFileSync("creditcanary-voice-spec.md", "utf8");
  const targetingMap = readFileSync("creditcanary-targeting-map.md", "utf8");

  _system = `You are drafting outreach emails AS Jim Fell, CEO of Credit Canary,
to warm contacts in his CRM. Credit Canary is a UK credit-decisioning +
payments platform for lenders.

Write in Jim's exact voice, following this VOICE SPEC:

${voiceSpec}

Use this TARGETING MAP to choose what to say. Find the lane for the contact's
sector; lead with the most relevant problem → capability → proof → angle, and
reference at most ONE content asset:

${targetingMap}

NON-NEGOTIABLE RULES:
1. RELEVANCE, NOT A SELL. Lead with a proprietary insight or observation
   ("here's what we're seeing…" / "the market said X, here's our data-backed
   take"), not a pitch. Low-pressure. The close is a soft, optional CTA.
2. ANONYMISATION (HARD). NEVER name a client or imply whose proof a metric
   belongs to. Use the descriptor from the map's anonymisation lookup
   ("a tier 1 UK retail bank", "a large national credit union", etc.). Keep
   the metric, drop the name. A draft naming a roster client is rejected.
3. ONE ANGLE. Pick the single most compelling angle; don't stack three.
4. SOUND HAND-WRITTEN. Short. Plain. British. Contractions. One idea. No
   marketing chrome, no bullet-point feature dumps, no corporate register.
5. Do NOT include a signature, sign-off block, or the calendar link — those
   are appended automatically. End the body on Jim's soft CTA sentence.
6. Open with "Hi <FirstName>,".

Return the subject, the body (no signature), the angle you led with (a short
label), and the URL of the single content asset you referenced (or "" if
none — only use a URL from the candidate list provided).`;

  return _system;
}

// AI outreach drafter — one bespoke email per prospect, tied to ONE specific
// piece of creditcanary.co.uk content, in Jim's voice, with a content-engagement
// CTA (NOT a meeting ask — the meeting comes later, once they engage).
//
// Inputs the model reads: the prospect (name/role/company/industry + the
// company's rolling Context), the website content map (creditcanary-site.md),
// and the voice spec (creditcanary-voice-spec.md). The anonymisation guard runs
// on the output and forces one rewrite if a client name leaks.

import { readFileSync } from "node:fs";
import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { checkAnonymisation } from "../generate/anonymisation";

export interface DraftInput {
  first_name: string | null;
  full_name: string | null;
  job_title: string | null;
  company_name: string | null;
  industry: string | null;
  company_context: string | null;
  /** Curated, per-contact research (recent posts, news, names, a problem
   *  statement) — the "we've done our homework" layer. */
  contact_context?: string | null;
  /** An inbound trigger to open on, e.g. "They just downloaded the Risk &
   *  Liquidity whitepaper." When set, lead with this, naturally. */
  trigger_note?: string | null;
}

/** Per-salesperson drafting dials. Defaults are Jim's; a future prompt-builder
 *  in the app will let each rep set their own and store them per user. */
export interface DraftConfig {
  senderName: string;
  /** Exact sign-off line, e.g. "Thanks, Jim". */
  signOff: string;
  /** The closing CTA, in the rep's words. */
  closeLine: string;
  /** Freeform voice/register guidance. */
  toneNotes: string;
  /** How long the email should be. */
  lengthGuidance: string;
  /** What the subject should do. */
  subjectStyle: string;
}

export const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  senderName: "Jim Fell",
  signOff: "Thanks, Jim",
  closeLine: "If you'd be open to connect, let me know — happy to share best practices we're seeing and see if we can be useful.",
  toneNotes:
    "Write as a valued industry partner to a senior peer — assured, warm, to the point. Never salesy, never junior, never needy. No throat-clearing (\"Hope you're well\", \"I wanted to reach out\"), no self-deprecating hedges (\"not a pitch\", \"no worries\", \"sorry to bother\"). They'll either find it valuable or they won't; respect their time and let the relevance do the work.",
  lengthGuidance: "Really short and sweet — a few tight sentences. Only go longer if there's a genuine, specific reason.",
  subjectStyle:
    "Short and intriguing, written purely to earn the open — a benefit or curiosity hook (e.g. \"driving growth for lenders\"), not a summary and not clickbait.",
};

export interface DraftResult {
  subject: string;
  body: string;
  page_url: string;
  page_title: string;
  angle: string;
}

const schema = z.object({
  subject: z.string().describe("Short, specific, lower-key subject line — relevance over clickbait."),
  body: z.string().describe("The email body, plain text, ~60–110 words, greeting the first name and signed off by the sender."),
  page_url: z.string().describe("The exact URL of the ONE creditcanary.co.uk page referenced, copied from the content map."),
  page_title: z.string().describe("That page's title."),
  angle: z.string().describe("One internal sentence: why this page for this prospect."),
});

// Spec files are read once and cached in-process (also cached as the AI system
// prefix across calls).
let _site: string | null = null;
let _voice: string | null = null;
const read = (p: string): string => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const siteMap = () => (_site ??= read("creditcanary-site.md"));
const voiceSpec = () => (_voice ??= read("creditcanary-voice-spec.md"));

function buildSystem(cfg: DraftConfig): string {
  return `You write a SINGLE, highly personalised outreach email for ${cfg.senderName} at Credit Canary — a UK credit decisioning, affordability and origination platform for lenders (banks, building societies, credit unions, brokers, specialist/consumer lenders).

APPROACH: lead with genuine relevance. Show — without saying so — that we've done our homework on this specific person and company, and have pinpointed one thing worth their attention. Point them to the single most relevant piece of CC content, then close with a warm invitation to connect.

VOICE
${cfg.toneNotes}

LENGTH
${cfg.lengthGuidance}

STRUCTURE
- Open straight into something specific and relevant to THEM (their company, a recent move/post/news, their role's priorities) — drawn from the research/context below. No throat-clearing, no "Hi X, hope you're well".
- Reference the ONE most relevant CC page by linking it naturally — this is the "we found something for you" signal.
- Close with this invitation, in the sender's voice (you may adjust lightly to flow, keep its warmth and intent): "${cfg.closeLine}"
- Sign off exactly: "${cfg.signOff}"

HARD RULES
- Pick EXACTLY ONE page from the WEBSITE CONTENT MAP below that best fits this prospect's sector and likely problem. Use its exact URL. NEVER invent a page, URL, statistic or claim — only use what the map provides.
- NEVER name or identify a Credit Canary client or case-study company in the body. Anonymise to descriptors (e.g. "a UK credit union", "a high-street bank", "a specialist lender"). This is absolute.
- Personalise only from real signal in the research/context or the prospect's role/sector. NEVER fabricate specifics (named people, events, numbers). If context is thin, personalise on sector/role honestly.
- NEVER apologise for a cold or "outside" approach, NEVER say you couldn't find information about them, and NEVER refer to the research/context process itself. If the research shows no specific signal, do not mention that — simply open with a relevant sector/role-level observation as if it's naturally pertinent. Confident, not apologetic.
- Subject line: ${cfg.subjectStyle}

VOICE SPEC (reference for register/phrasing)
${voiceSpec() || "(voice spec unavailable — write in a plain, warm, concise British B2B voice.)"}

WEBSITE CONTENT MAP
${siteMap() || "(content map unavailable.)"}`;
}

function buildUser(input: DraftInput): string {
  return [
    "Draft the email for this prospect.",
    "",
    "PROSPECT",
    `- Name: ${input.full_name ?? input.first_name ?? "(unknown)"}`,
    `- First name: ${input.first_name ?? "(unknown)"}`,
    `- Role: ${input.job_title ?? "(unknown)"}`,
    `- Company: ${input.company_name ?? "(unknown)"}`,
    `- Industry: ${input.industry ?? "(unknown)"}`,
    "",
    ...(input.trigger_note?.trim()
      ? ["", `INBOUND TRIGGER (they just did this — open on it naturally, warmly; they're expecting to hear from us): ${input.trigger_note.trim()}`]
      : []),
    "",
    "RESEARCH / CONTEXT (use this to make it personal — do not invent beyond it)",
    `- Contact context: ${input.contact_context?.trim() || "(none yet)"}`,
    `- Company context: ${input.company_context?.trim() || "(none yet)"}`,
  ].join("\n");
}

export async function draftEmail(input: DraftInput, config: DraftConfig = DEFAULT_DRAFT_CONFIG): Promise<DraftResult> {
  const system = buildSystem(config);
  const user = buildUser(input);

  let draft = await generateStructured({ system, user, schema, effort: "high", maxTokens: 1500 });
  let check = checkAnonymisation(`${draft.subject}\n${draft.body}`);
  if (!check.clean) {
    draft = await generateStructured({
      system,
      user: `${user}\n\nYour previous attempt named a client (${check.hits.join(", ")}). Rewrite WITHOUT naming any client — use an anonymised descriptor instead.`,
      schema, effort: "high", maxTokens: 1500,
    });
    check = checkAnonymisation(`${draft.subject}\n${draft.body}`);
    if (!check.clean) throw new Error(`Anonymisation leak persists: ${check.hits.join(", ")}`);
  }
  return draft;
}

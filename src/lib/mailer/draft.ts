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
    "Write as a valued industry partner to a senior peer — assured, warm, to the point. Measured British business English: never breezy, casual or American, never salesy, junior or needy. Write COMPLETE sentences — never clipped, subject-dropped fragments (write \"We wrote up what we learned\", not \"Wrote up what we learned\"; \"I'd be happy to…\", not \"Happy to…\"). No throat-clearing (\"Hope you're well\", \"I wanted to reach out\"), no self-deprecating hedges (\"not a pitch\", \"no worries\", \"sorry to bother\"). Respect their time and let the relevance do the work.",
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

// We only ever point a prospect at content that *inspires* — a point of view, a
// lesson, a peer result. The purpose is to give them something genuinely useful,
// not to route them to a pitch. So the drafter is only shown the "Case studies"
// and "Articles & use-cases" sections of the map; product/platform/data-product
// pages, the home page, About, sector landing pages and the like are stripped
// before the model ever sees them, so it cannot pick one. (The on-disk map stays
// the complete human reference; this filtering is read-only.)
const INSPIRING_SECTIONS = ["case studies", "articles & use-cases"];
function toInspiringMap(md: string): string {
  const out: string[] = [];
  let keep = true; // keep the intro/guidance before the first "## " section
  for (const line of md.split("\n")) {
    const m = /^## (.+)$/.exec(line);
    if (m) {
      const title = (m[1] ?? "").trim().toLowerCase();
      keep = INSPIRING_SECTIONS.some((s) => title.startsWith(s));
    }
    if (keep) out.push(line);
  }
  return out.join("\n").trim();
}
const siteMap = () => (_site ??= toInspiringMap(read("creditcanary-site.md")));
const voiceSpec = () => (_voice ??= read("creditcanary-voice-spec.md"));

function buildSystem(cfg: DraftConfig): string {
  return `You write a SINGLE, highly personalised outreach email for ${cfg.senderName} at Credit Canary — a UK credit decisioning, affordability and origination platform for lenders (banks, building societies, credit unions, brokers, specialist/consumer lenders).

APPROACH: lead with genuine relevance, and give them something genuinely useful. The purpose of this email is to INSPIRE this person — to hand them a point of view, a lesson, or a peer's result that speaks to their world and makes them think "that's relevant to me" — NOT to pitch a product or route them to a sales page. Show — without saying so — that we've done our homework on this specific person and company, pinpoint one genuinely worthwhile piece of thinking for them, and share it as a useful read. Then close with a warm invitation to connect. The content is the gift; the product is never mentioned.

VOICE
${cfg.toneNotes}

LENGTH
${cfg.lengthGuidance}

STRUCTURE
- Greet with "Hi <first name>," then go straight into something specific and relevant to THEM (their company, a recent move/post/news, their role's priorities) — drawn from the research/context below. No "hope you're well", no weather.
- Reference the ONE most relevant CC page by linking it naturally — share it as a genuinely useful read, the "I thought of you when I saw this" signal. Never frame it as a product or a sales asset.
- Close with this invitation, in the sender's voice (you may adjust lightly to flow, keep its warmth and intent): "${cfg.closeLine}"
- Then a brief, warm, courteous closing line before the sign-off (e.g. "Look forward to the opportunity to speak").
- Sign off exactly: "${cfg.signOff}"
- Write in complete, measured British sentences throughout — no clipped fragments, no breezy/casual phrasing.

HARD RULES
- Pick EXACTLY ONE page from the WEBSITE CONTENT MAP below — the single most genuinely useful, inspiring read for this prospect's sector and likely problem (an article, opinion piece, use-case perspective or peer case study). Use its exact URL. NEVER invent a page, URL, statistic or claim — only use what the map provides.
- The map deliberately contains ONLY inspiring content — articles, opinions, use-cases and case studies. You must NEVER link to or steer them toward the home page, the About page, a "Credit Canary for <sector>" page, a platform/module or data-product page, pricing, or a "book a demo" page. We are inspiring them with a useful read, not pitching a product.
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

// ── URL grounding ───────────────────────────────────────────────────────
// The model must link an EXACT page from the content map, never an invented
// one. We parse the real URLs out of the map and reject any draft whose chosen
// page (or any link in its body) isn't one of them — forcing a re-draft.
const normUrl = (u: string): string =>
  u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;)\]]+$/, "").replace(/\/+$/, "");

function mapUrls(): Set<string> {
  const set = new Set<string>();
  for (const m of siteMap().matchAll(/^- URL:\s*(\S+)/gm)) set.add(normUrl(m[1] ?? ""));
  return set;
}

const extractUrls = (text: string): string[] =>
  [...text.matchAll(/https?:\/\/[^\s)<>"']+/g)].map((m) => m[0]);

/** Returns a problem string if the draft's links aren't grounded in the map,
 *  else null. Skipped when the map is unavailable (can't validate). */
function urlProblem(draft: DraftResult, valid: Set<string>): string | null {
  if (valid.size === 0) return null;
  const page = draft.page_url ? normUrl(draft.page_url) : "";
  if (!page || !valid.has(page)) return `the chosen page_url "${draft.page_url || "(blank)"}" is not an exact URL from the content map`;
  const bodyUrls = extractUrls(draft.body).map(normUrl);
  const invented = bodyUrls.find((u) => !valid.has(u));
  if (invented) return `the email body links "${invented}", which is not in the content map`;
  if (!bodyUrls.includes(page)) return "the email body does not contain the chosen page URL as a link";
  return null;
}

export async function draftEmail(input: DraftInput, config: DraftConfig = DEFAULT_DRAFT_CONFIG): Promise<DraftResult> {
  const system = buildSystem(config);
  const user = buildUser(input);
  const valid = mapUrls();

  let draft = await generateStructured({ system, user, schema, effort: "high", maxTokens: 1500 });
  // One corrective retry covering BOTH guards: client-name leaks and ungrounded
  // (invented / 404 / missing) links. If it still fails, throw rather than queue
  // a bad email.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const anon = checkAnonymisation(`${draft.subject}\n${draft.body}`);
    const urlErr = urlProblem(draft, valid);
    if (anon.clean && !urlErr) return draft;
    if (attempt === 2) throw new Error(`Draft failed validation: ${[anon.clean ? null : `client name leaked (${anon.hits.join(", ")})`, urlErr].filter(Boolean).join("; ")}`);
    const notes = [
      anon.clean ? null : `You named a client (${anon.hits.join(", ")}). Rewrite WITHOUT naming any client — use an anonymised descriptor instead.`,
      urlErr ? `Link problem: ${urlErr}. Pick ONE page from the WEBSITE CONTENT MAP above and copy its URL EXACTLY — into both page_url and the email body. NEVER invent, shorten or guess a URL.` : null,
    ].filter(Boolean).join(" ");
    draft = await generateStructured({ system, user: `${user}\n\nYour previous attempt was rejected: ${notes}`, schema, effort: "high", maxTokens: 1500 });
  }
  throw new Error("unreachable");
}

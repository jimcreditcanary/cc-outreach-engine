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
  senderName?: string;
}

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

function buildSystem(senderName: string): string {
  return `You write a SINGLE, highly personalised outreach email for ${senderName} at Credit Canary — a UK credit decisioning, affordability and origination platform for lenders (banks, building societies, credit unions, brokers, specialist/consumer lenders).

GOAL: earn a click to ONE specific, relevant piece of content on creditcanary.co.uk. The call to action is a low-pressure invitation to read/see that one thing — NOT a request for a meeting or a call. We lead with value and stay present; the meeting comes later, only once they engage.

HARD RULES
- Pick EXACTLY ONE page from the WEBSITE CONTENT MAP below that best fits this prospect's sector and likely problem. Use its exact URL. NEVER invent a page, URL, statistic or claim — only use what the map provides.
- NEVER name or identify a Credit Canary client or case-study company in the body. Anonymise to descriptors (e.g. "a UK credit union", "a high-street bank", "a specialist lender"). This is absolute.
- Match the VOICE SPEC exactly: peer-to-peer, plain, confident, concise. No hype, no buzzword stacks, no "I hope this finds you well", no manufactured flattery, no multi-paragraph pitch. One clear idea.
- ~60–110 words. Greet by first name. Sign off as ${senderName}, Credit Canary. Put the one link in naturally as the CTA.
- Personalise from the prospect's role, company, industry and COMPANY CONTEXT when present. If context is thin, personalise on sector/role — never fabricate specifics.

VOICE SPEC
${voiceSpec() || "(voice spec unavailable — write in a plain, warm, concise British B2B voice.)"}

WEBSITE CONTENT MAP
${siteMap() || "(content map unavailable.)"}`;
}

function buildUser(input: DraftInput): string {
  return [
    "Draft the email for this prospect:",
    `- Name: ${input.full_name ?? input.first_name ?? "(unknown)"}`,
    `- First name: ${input.first_name ?? "(unknown)"}`,
    `- Role: ${input.job_title ?? "(unknown)"}`,
    `- Company: ${input.company_name ?? "(unknown)"}`,
    `- Industry: ${input.industry ?? "(unknown)"}`,
    `- Company context: ${input.company_context?.trim() || "(none yet)"}`,
  ].join("\n");
}

export async function draftEmail(input: DraftInput): Promise<DraftResult> {
  const senderName = input.senderName ?? "Jim Fell";
  const system = buildSystem(senderName);
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

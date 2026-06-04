// Draft generator: turn a contact + their context into a queued draft, in
// Jim's voice, gated by the anonymisation post-check (regenerate once on a
// roster leak, then give up and flag).

import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { buildSystemPrompt, SCHEDULER_LINK, unsubFooterText, unsubFooterHtml } from "./config";
import { signatureHtml, signatureText, type Sender } from "./sender";
import { checkAnonymisation } from "./anonymisation";
import type { MatchedSignal } from "../signals/triggers";

export interface ContactCtx {
  first_name: string;
  full_name: string;
  email: string;
  job_title?: string | null;
  org_name: string;
  sector: string;
  tier: number | null;
  label?: string | null;
  /** Recent org notes — the "what's changed since we spoke" context (T2). */
  notes: string[];
  /** Optional AI-written summary of the company (from their own website). */
  org_summary?: string | null;
  /** Optional last 3 recent posts from the company's blog/news feed. */
  recent_posts?: { title: string; published_at: string | null }[];
  /** Optional campaign-level theme/style hint (per-sequence text the
   *  operator wrote — e.g. "Money 2020 attendees — lead with cost-of-
   *  living"). Injected as a CAMPAIGN CONTEXT block. */
  theme?: string | null;
  /** Optional cadence step hint — when set, the prompt nudges the model
   *  to the right tone/length for THAT step (opener vs follow-up vs
   *  case-study vs breakup). One of:
   *    'initial' | 'followup' | 'case' | 'breakup' */
  step_kind?: "initial" | "followup" | "case" | "breakup" | null;
}

export interface AssetOption {
  url: string;
  title: string | null;
  description?: string | null;
  type?: string | null;
  tags_problem: string[];
}

export interface DraftResult {
  subject: string;
  body_text: string;
  body_html: string;
  angle: string;
  asset_url: string;
}

const DraftSchema = z.object({
  subject: z.string(),
  body_text: z.string(),
  angle: z.string(),
  asset_url: z.string(),
});

function buildUserPrompt(
  ctx: ContactCtx,
  assets: AssetOption[],
  signals: MatchedSignal[],
  sender: Sender,
  correction?: string,
): string {
  const notes =
    ctx.notes.length > 0
      ? ctx.notes.map((n, i) => `  ${i + 1}. ${n}`).join("\n")
      : "  (none on file)";
  const assetList =
    assets.length > 0
      ? assets
          .map(
            (a) =>
              `  - ${a.url}\n    "${a.title ?? ""}" [${a.type ?? "page"}] problems: ${a.tags_problem.join(", ") || "—"}`,
          )
          .join("\n")
      : "  (none)";

  const tierNote =
    ctx.tier === 2
      ? "Tier 2 (lapsed deal): re-engage on what's changed since you last spoke + the most relevant new asset."
      : "Tier 3 (no proposal yet): content/capability nurture — earn relevance, no hard ask.";

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });

  const stepGuide = ctx.step_kind === "followup"
    ? "STEP: this is the Day-4 FOLLOW-UP email after a Day-1 opener. Stay under 120 words. Lead with a value-driven insight (industry trend, FCA pressure, BNPL growth, AI underwriting, cost reduction, CX). No 'just checking in'."
    : ctx.step_kind === "case"
    ? "STEP: this is the Day-10 CASE-STUDY email. Short client story with metrics — e.g. \"reduced decision times by 40%\", \"cut manual referrals by 30%\". Quick win + ROI. Anonymised."
    : ctx.step_kind === "breakup"
    ? "STEP: this is the Day-13 BREAKUP email. Low-pressure close-the-loop. Acknowledge that timing/priority/ownership might be off; offer to reconnect later in the year. Short."
    : ctx.step_kind === "initial"
    ? "STEP: this is the Day-1 OPENER. Awareness, not pitching. Angle = one of: faster credit decisions, lower manual underwriting, better fraud/risk controls, improved acceptance rates, regulatory/compliance efficiency."
    : "";

  const themeBlock = ctx.theme
    ? `CAMPAIGN CONTEXT (operator-written — fold into the angle if relevant):\n  ${ctx.theme}\n\n`
    : "";

  return `${correction ? correction + "\n\n" : ""}Today is ${today}. Do not reference any other season, month, quarter, or year.${stepGuide ? `\n\n${stepGuide}` : ""}

SENDER (you are drafting AS this person — write in their voice, sign off
"${sender.first_name}"):
  ${sender.full_name}${sender.job_title ? `, ${sender.job_title}` : ""}, ${sender.company}
  Reply-to email: ${sender.reply_to_email}

${themeBlock}CONTACT
  Name: ${ctx.full_name} (open with "Hi ${ctx.first_name},")
  Job title: ${ctx.job_title ?? "unknown"}
  Organisation: ${ctx.org_name}
  Sector: ${ctx.sector}
  CRM label: ${ctx.label ?? "—"}
  Tier: ${tierNote}

${ctx.org_summary ? `ABOUT ${ctx.org_name.toUpperCase()} (from their own website — fair game to reference):\n  ${ctx.org_summary}\n\n` : ""}${ctx.recent_posts && ctx.recent_posts.length > 0 ? `RECENT POSTS ON THEIR BLOG / NEWS (real, current — feel free to reference one if it's a genuine hook):\n${ctx.recent_posts.slice(0, 3).map((p) => `  - "${p.title}"${p.published_at ? ` (${new Date(p.published_at).toLocaleDateString("en-GB")})` : ""}`).join("\n")}\n\n` : ""}RECENT CRM NOTES (context — never quote a client name from these in the email):
${notes}

CANDIDATE CONTENT ASSETS (link exactly ONE of these in the body if a genuinely
relevant one exists; use its exact URL):
${assetList}

If none of the assets above genuinely fit the angle, link this meeting
scheduler in your CTA instead (this is the fallback link):
  ${SCHEDULER_LINK}

RECENT REGULATORY / MARKET SIGNALS for this sector (lead with one ONLY if it's
genuinely relevant and timely — it's the strongest insight-first hook; otherwise
ignore them entirely):
${signals.length > 0 ? signals.map((s) => `  - [${s.source}] ${s.title} — angle: ${s.note}`).join("\n") : "  (none)"}

Write the email now.`;
}

/**
 * Generate one draft. Returns null if it can't pass the anonymisation gate
 * after a regeneration attempt (caller should flag, not send).
 */
const hasLink = (s: string) => /https?:\/\/\S+/.test(s);

function assemble(out: z.infer<typeof DraftSchema>, email: string, sender: Sender): DraftResult {
  return {
    subject: out.subject,
    body_text: `${out.body_text.trim()}\n\n${signatureText(sender)}${unsubFooterText(email)}`,
    body_html: renderHtml(out.body_text, email, sender),
    angle: out.angle,
    asset_url: out.asset_url,
  };
}

export async function generateDraft(
  ctx: ContactCtx,
  assets: AssetOption[],
  signals: MatchedSignal[] = [],
  sender: Sender,
): Promise<DraftResult | null> {
  const system = buildSystemPrompt();
  let correction: string | undefined;
  let lastClean: z.infer<typeof DraftSchema> | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await generateStructured({
      system,
      user: buildUserPrompt(ctx, assets, signals, sender, correction),
      schema: DraftSchema,
      effort: "medium",
      maxTokens: 2000,
    });

    const anonClean = checkAnonymisation(`${out.subject}\n${out.body_text}`).clean;
    const linked = hasLink(out.body_text);

    if (anonClean && linked) return assemble(out, ctx.email, sender);

    if (anonClean) lastClean = out; // usable except for the missing link
    correction = !anonClean
      ? "Your previous draft named a real client, which is forbidden. Rewrite using ONLY the anonymised descriptors from the targeting map."
      : "Your previous draft had NO link in the body. Rewrite and weave in exactly one link — a relevant Credit Canary asset, or the meeting scheduler — inside a sentence.";
  }

  // Anonymisation passed but the model still wouldn't add a link: inject the
  // scheduler CTA ourselves rather than discard a good draft.
  if (lastClean) {
    const body = `${lastClean.body_text.trim()}\n\nIf it's useful, grab a time here: ${SCHEDULER_LINK}`;
    return assemble({ ...lastClean, body_text: body, asset_url: SCHEDULER_LINK }, ctx.email, sender);
  }
  return null; // failed the anonymisation gate twice
}

/** Native-looking HTML: system font, plain paragraphs, simple signature. */
function renderHtml(bodyText: string, email: string, sender: Sender): string {
  const paragraphs = bodyText
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${paragraphs}
${signatureHtml(sender)}
${unsubFooterHtml(email)}
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wrap URLs in anchors, leaving any trailing punctuation outside the link. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+?)([.,;:!?)\]]*)(?=\s|$)/g,
    '<a href="$1">$1</a>$2',
  );
}

// Draft generator: turn a contact + their context into a queued draft, in
// Jim's voice, gated by the anonymisation post-check (regenerate once on a
// roster leak, then give up and flag).

import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { buildSystemPrompt, SIGNATURE_TEXT, SIGNATURE_HTML } from "./config";
import { checkAnonymisation } from "./anonymisation";

export interface ContactCtx {
  first_name: string;
  full_name: string;
  job_title?: string | null;
  org_name: string;
  sector: string;
  tier: number | null;
  label?: string | null;
  /** Recent org notes — the "what's changed since we spoke" context (T2). */
  notes: string[];
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

function buildUserPrompt(ctx: ContactCtx, assets: AssetOption[], correction?: string): string {
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

  return `${correction ? correction + "\n\n" : ""}Today is ${today}. Do not reference any other season, month, quarter, or year.

CONTACT
  Name: ${ctx.full_name} (open with "Hi ${ctx.first_name},")
  Job title: ${ctx.job_title ?? "unknown"}
  Organisation: ${ctx.org_name}
  Sector: ${ctx.sector}
  CRM label: ${ctx.label ?? "—"}
  Tier: ${tierNote}

RECENT CRM NOTES (context — never quote a client name from these in the email):
${notes}

CANDIDATE CONTENT ASSETS (reference at most one; use its exact URL):
${assetList}

Write the email now.`;
}

/**
 * Generate one draft. Returns null if it can't pass the anonymisation gate
 * after a regeneration attempt (caller should flag, not send).
 */
export async function generateDraft(ctx: ContactCtx, assets: AssetOption[]): Promise<DraftResult | null> {
  const system = buildSystemPrompt();

  for (let attempt = 0; attempt < 2; attempt++) {
    const correction =
      attempt === 0
        ? undefined
        : "Your previous draft named a real client, which is forbidden. Rewrite using ONLY the anonymised descriptors from the targeting map.";

    const out = await generateStructured({
      system,
      user: buildUserPrompt(ctx, assets, correction),
      schema: DraftSchema,
      effort: "medium",
      maxTokens: 2000,
    });

    const check = checkAnonymisation(`${out.subject}\n${out.body_text}`);
    if (check.clean) {
      return {
        subject: out.subject,
        body_text: `${out.body_text.trim()}\n\n${SIGNATURE_TEXT}`,
        body_html: renderHtml(out.body_text),
        angle: out.angle,
        asset_url: out.asset_url,
      };
    }
  }
  return null; // failed the gate twice
}

/** Native-looking HTML: system font, plain paragraphs, simple signature. */
function renderHtml(bodyText: string): string {
  const paragraphs = bodyText
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${paragraphs}
${SIGNATURE_HTML}
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

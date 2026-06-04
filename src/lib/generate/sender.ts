// Sender identity resolver — pulls the human bits (name, signoff,
// signature blocks) for the operator whose owner_id the draft belongs
// to. Used by:
//   - generateDraft (system prompt + signature blocks)
//   - regenerateForContact (resolves owner → sender)
//   - newsletter send action
//
// Falls back to the workspace defaults (POSTMARK_FROM, POSTMARK_REPLY_TO)
// when ownerId is null or the operator hasn't filled in their profile.
// The workspace default is "Jim Fell, CEO" — so legacy single-tenant
// behaviour is preserved when no owner is given.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Sender {
  /** Display name used in the email body signoff. */
  full_name: string;
  /** Just the first name — opens the signoff ("Jim", "Ross"). */
  first_name: string;
  /** Plain-address email for the body signature. */
  reply_to_email: string;
  /** Optional job title for the prompt's "drafting AS X" line. */
  job_title: string | null;
  /** Always "Credit Canary" — kept here so future white-label is one file. */
  company: string;
}

const DEFAULT_SENDER: Sender = {
  full_name: "Jim Fell",
  first_name: "Jim",
  reply_to_email: process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk",
  job_title: "CEO",
  company: "Credit Canary",
};

/** Look up the sender for an owner_id. Joins user_settings (for name,
 *  job_title, reply_to_email) and falls back to the workspace default
 *  for anything missing. Pure-read — safe to call from any context. */
export async function resolveSender(
  db: SupabaseClient,
  ownerId: string | null | undefined,
): Promise<Sender> {
  if (!ownerId) return DEFAULT_SENDER;
  const { data } = await db
    .from("user_settings")
    .select("first_name, last_name, job_title, reply_to_email, from_email")
    .eq("user_id", ownerId)
    .maybeSingle();
  const s = data as { first_name: string | null; last_name: string | null; job_title: string | null; reply_to_email: string | null; from_email: string | null } | null;
  if (!s) return DEFAULT_SENDER;

  // Try first/last from the explicit profile fields (migration 030); if
  // those are blank, fall back to the name embedded in from_email
  // ("Name <addr>" → "Name"); if THAT's blank too, fall back to the
  // workspace default.
  const explicit = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  const fromNameMatch = (s.from_email ?? "").match(/^"?([^<"]+?)"?\s*</);
  const fullName = explicit || fromNameMatch?.[1]?.trim() || DEFAULT_SENDER.full_name;
  const firstName = (s.first_name && s.first_name.trim()) || fullName.split(/\s+/)[0] || DEFAULT_SENDER.first_name;

  return {
    full_name: fullName,
    first_name: firstName,
    reply_to_email: s.reply_to_email || DEFAULT_SENDER.reply_to_email,
    job_title: s.job_title || null,
    company: DEFAULT_SENDER.company,
  };
}

/** Plain-text signature block — appended below the AI-written body. */
export function signatureText(sender: Sender): string {
  return `${sender.first_name}

${sender.full_name}
${sender.company}
${sender.reply_to_email}`;
}

/** HTML signature block — system-font, no template chrome. */
export function signatureHtml(sender: Sender): string {
  return `<p>${sender.first_name}</p>
<p style="color:#666">${sender.full_name}<br>
${sender.company}<br>
<a href="mailto:${sender.reply_to_email}">${sender.reply_to_email}</a></p>`;
}

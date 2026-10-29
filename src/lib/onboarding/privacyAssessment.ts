// Phase 3c — AI assessment of the merchant's privacy policy. Fetches the policy
// URL (from the merchant form), strips it to text, and asks Claude to score its
// coverage against GDPR / TransUnion end-user due-diligence requirements. Stored
// per case; re-runnable. Advisory only — a human signs off.

import { z } from "zod";
import type { serviceClient } from "../db/client";
import { generateStructured } from "../ai/claude";
import { loadMerchantForm } from "./merchantForm";
import { logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;

const coverageSchema = z.object({
  lawful_basis: z.boolean(),
  data_subject_rights: z.boolean(),
  retention: z.boolean(),
  third_party_sharing: z.boolean(),
  security_measures: z.boolean(),
  dpo_or_contact: z.boolean(),
  international_transfers: z.boolean(),
});
const assessSchema = z.object({
  reachable: z.boolean(),
  summary: z.string().describe("2–3 sentences on the policy's adequacy."),
  coverage: coverageSchema,
  gaps: z.array(z.string()).describe("Required topics not adequately covered."),
  concerns: z.array(z.string()).describe("Anything that looks non-compliant or risky."),
  overall: z.enum(["adequate", "minor_gaps", "inadequate", "unreachable"]),
});
export type PrivacyAssessment = z.infer<typeof assessSchema>;

const SYSTEM = `You are a UK data-protection analyst assessing a company's published privacy policy against UK GDPR and TransUnion end-user due-diligence requirements. From the policy TEXT ONLY (do not invent), judge whether it adequately covers: lawful basis for processing, data-subject rights, data retention, third-party/data sharing, security measures, a DPO or data-protection contact, and international transfers. List concrete gaps and any compliance concerns, and give an overall rating. Be strict but fair; this is advisory and a human signs off.`;

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchPolicyText(url: string): Promise<string | null> {
  if (!isSafeUrl(url)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "CreditCanaryOnboarding/1.0" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 200 ? text.slice(0, 18_000) : null;
  } catch {
    return null;
  }
}

export interface StoredPrivacyAssessment {
  url: string | null;
  result: PrivacyAssessment | null;
  assessed_at: string | null;
}

export async function loadPrivacyAssessment(db: DB, caseId: string): Promise<StoredPrivacyAssessment | null> {
  try {
    const { data } = await db.from("onboarding_privacy_assessment").select("url, result, assessed_at").eq("case_id", caseId).maybeSingle();
    return (data as StoredPrivacyAssessment | null) ?? null;
  } catch {
    return null;
  }
}

/** Fetch + assess the merchant's privacy policy, store the result. */
export async function assessPrivacyPolicy(db: DB, caseId: string, actor: { id?: string | null; email?: string | null }): Promise<PrivacyAssessment> {
  const { form } = await loadMerchantForm(db, caseId);
  const url = (form?.compliance?.privacy_policy_url ?? "").trim();

  let result: PrivacyAssessment;
  if (!url) {
    result = { reachable: false, summary: "No privacy-policy URL was provided on the merchant form.", coverage: emptyCoverage(), gaps: ["No privacy policy supplied."], concerns: [], overall: "unreachable" };
  } else {
    const text = await fetchPolicyText(url);
    if (!text) {
      result = { reachable: false, summary: `Could not fetch readable text from ${url}.`, coverage: emptyCoverage(), gaps: [], concerns: ["Policy URL unreachable or not machine-readable — review manually."], overall: "unreachable" };
    } else {
      result = await generateStructured({ system: SYSTEM, user: `Privacy policy URL: ${url}\n\n---\n${text}`, schema: assessSchema, effort: "medium", maxTokens: 1500 });
    }
  }

  await db.from("onboarding_privacy_assessment").upsert(
    { case_id: caseId, url: url || null, result, assessed_at: new Date().toISOString() },
    { onConflict: "case_id" },
  );
  await logCaseEvent(db, caseId, "privacy_assessed", actor, { overall: result.overall });
  return result;
}

function emptyCoverage() {
  return { lawful_basis: false, data_subject_rights: false, retention: false, third_party_sharing: false, security_measures: false, dpo_or_contact: false, international_transfers: false };
}

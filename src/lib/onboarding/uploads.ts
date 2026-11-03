// Phase 3c — merchant document uploads + AI extraction. Files go to the private
// 'onboarding-uploads' Supabase Storage bucket (migration 054); metadata +
// extraction live in onboarding_uploads. Extraction is best-effort and
// team-triggered: PDFs go to Claude's document reader, text files inline; other
// formats are stored for manual review. Advisory only.

import crypto from "node:crypto";
import { z } from "zod";
import type { serviceClient } from "../db/client";
import { generateStructured } from "../ai/claude";
import { extractRawText } from "../proposals/extract";

type DB = ReturnType<typeof serviceClient>;
export const UPLOAD_BUCKET = "onboarding-uploads";

export interface UploadFile { name: string; type: string; bytes: Uint8Array }

/** Store one uploaded file in the private bucket + record its metadata. `uboRef`
 *  ties a UBO identity document to a beneficial owner (resilient to migration
 *  069 not being applied yet). */
export async function saveUpload(db: DB, caseId: string, file: UploadFile, kind = "infosec", uboRef?: string): Promise<void> {
  const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  const path = `${caseId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const up = await db.storage.from(UPLOAD_BUCKET).upload(path, file.bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;
  const base = {
    case_id: caseId, kind, filename: file.name, storage_path: path,
    content_type: file.type || null, size_bytes: file.bytes.byteLength,
  };
  const row = uboRef ? { ...base, ubo_ref: uboRef } : base;
  let ins = await db.from("onboarding_uploads").insert(row as typeof base);
  if (ins.error && uboRef && /(column|schema cache|does not exist)/i.test(ins.error.message) && /ubo_ref/i.test(ins.error.message)) {
    ins = await db.from("onboarding_uploads").insert(base);
  }
  if (ins.error) throw ins.error;
}

export interface UploadRow {
  id: string;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  extracted: UploadExtraction | null;
  extracted_at: string | null;
  created_at: string;
}

export async function loadUploads(db: DB, caseId: string): Promise<UploadRow[]> {
  try {
    const { data } = await db
      .from("onboarding_uploads")
      .select("id, filename, content_type, size_bytes, extracted, extracted_at, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    return (data as UploadRow[] | null) ?? [];
  } catch {
    return [];
  }
}

const extractSchema = z.object({
  document_type: z.string().describe("what kind of document this is"),
  summary: z.string(),
  key_points: z.array(z.string()),
  security_controls: z.array(z.string()).describe("named controls / certifications / standards"),
  dates: z.array(z.string()).describe("relevant dates, e.g. certificate expiry or test date"),
  last_updated_date: z.string().describe("the document's issue / last-updated / certificate date as YYYY-MM-DD if stated, else empty string"),
  pentest_findings: z.object({ low: z.number(), medium: z.number(), high: z.number() }).describe("counts of findings by severity for a penetration-test report; all 0 if not a pentest or none found"),
  executive_summary: z.string().describe("for a penetration-test report only: a short executive summary covering scope, key findings, risk ratings and remediation status; empty string otherwise"),
  flags: z.array(z.string()).describe("concerns or missing information"),
});
export type UploadExtraction = z.infer<typeof extractSchema> & { error?: string };

const EMPTY_EXTRACTION = (document_type: string, summary: string, error?: string): UploadExtraction => ({
  document_type, summary, key_points: [], security_controls: [], dates: [],
  last_updated_date: "", pentest_findings: { low: 0, medium: 0, high: 0 }, executive_summary: "", flags: [], ...(error ? { error } : {}),
});

const EXTRACT_SYSTEM = `You are an information-security reviewer extracting key facts from a document a merchant uploaded during onboarding (security policy, ISO 27001 / SOC 2 certificate, penetration-test report, cyber-insurance certificate, DPA, etc.). From the document only (do not invent): identify its type, a short summary, key points, named security controls / certifications / standards, relevant dates, the document's own last-updated / issue / certificate date (as YYYY-MM-DD if stated), and any flags or missing information. If it is a penetration-test report, also count findings by severity (low/medium/high) and write a short executive summary (scope, key findings, risk ratings, remediation status).`;

const kindHint = (kind: string): string =>
  kind === "pentest" ? "This is a penetration-test report — extract findings counts by severity and an executive summary."
  : kind === "infosec_policy" ? "This is an information-security policy — note its last-updated date."
  : kind === "cyber_insurance" ? "This is a cyber-insurance certificate — note its coverage dates."
  : "";

/** Best-effort extraction of one upload. PDFs → Claude document reader; text
 *  inline; other formats stored for manual review. Adds a >12-month age flag and
 *  a medium/high pen-test findings flag. Never throws. */
export async function extractUpload(db: DB, uploadId: string): Promise<void> {
  const { data: row } = await db
    .from("onboarding_uploads")
    .select("id, storage_path, content_type, filename, kind")
    .eq("id", uploadId)
    .maybeSingle();
  if (!row) return;
  const r = row as { storage_path: string; content_type: string | null; filename: string | null; kind: string | null };

  let extracted: UploadExtraction;
  try {
    const dl = await db.storage.from(UPLOAD_BUCKET).download(r.storage_path);
    if (dl.error || !dl.data) throw new Error("could not download the file");
    const buf = Buffer.from(await dl.data.arrayBuffer());
    // extractRawText handles pdf / docx / txt / md (throws on other formats).
    const text = (await extractRawText(buf, r.filename ?? "file")).slice(0, 18_000);
    if (!text.trim()) {
      extracted = EMPTY_EXTRACTION(r.content_type || "unknown", "No readable text could be extracted — stored for manual review.");
    } else {
      const hint = kindHint(r.kind ?? "");
      extracted = await generateStructured({ system: EXTRACT_SYSTEM, user: `Extract the key facts from this document.${hint ? ` ${hint}` : ""}\n\n---\n${text}`, schema: extractSchema, effort: "low", maxTokens: 1800 });
      // Behind-the-scenes flags (brief §1.6.4): document age + pen-test severity.
      const ageMonths = monthsSince(extracted.last_updated_date);
      if (ageMonths != null && ageMonths > 12) extracted.flags = [...extracted.flags, `Document is over 12 months old (dated ${extracted.last_updated_date}).`];
      const f = extracted.pentest_findings;
      if ((f?.medium ?? 0) > 0 || (f?.high ?? 0) > 0) extracted.flags = [...extracted.flags, `Penetration test has ${f.high} high / ${f.medium} medium finding(s) — see executive summary.`];
    }
  } catch (e) {
    extracted = EMPTY_EXTRACTION(r.content_type || "unknown", `Stored for manual review — ${(e as Error).message}`, (e as Error).message);
  }

  await db.from("onboarding_uploads").update({ extracted, extracted_at: new Date().toISOString() }).eq("id", uploadId);
}

/** Whole months between a YYYY-MM-DD date and now, or null if unparseable. */
function monthsSince(dateStr: string): number | null {
  if (!dateStr?.trim()) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (30.44 * 86_400_000);
}

/** Run extraction over a case's not-yet-extracted uploads (best-effort, capped). */
export async function extractPendingUploads(db: DB, caseId: string, limit = 6): Promise<void> {
  try {
    const { data } = await db.from("onboarding_uploads").select("id").eq("case_id", caseId).is("extracted", null).limit(limit);
    for (const row of (data as { id: string }[] | null) ?? []) await extractUpload(db, row.id).catch(() => {});
  } catch {
    /* best-effort */
  }
}

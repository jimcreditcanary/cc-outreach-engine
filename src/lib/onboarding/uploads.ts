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

/** Store one uploaded file in the private bucket + record its metadata. */
export async function saveUpload(db: DB, caseId: string, file: UploadFile, kind = "infosec"): Promise<void> {
  const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  const path = `${caseId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const up = await db.storage.from(UPLOAD_BUCKET).upload(path, file.bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;
  const ins = await db.from("onboarding_uploads").insert({
    case_id: caseId, kind, filename: file.name, storage_path: path,
    content_type: file.type || null, size_bytes: file.bytes.byteLength,
  });
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
  flags: z.array(z.string()).describe("concerns or missing information"),
});
export type UploadExtraction = z.infer<typeof extractSchema> & { error?: string };

const EXTRACT_SYSTEM = `You are an information-security reviewer extracting key facts from a document a merchant uploaded during onboarding (security policy, ISO 27001 / SOC 2 certificate, penetration-test summary, DPA, etc.). From the document only (do not invent): identify its type, a short summary, key points, named security controls / certifications / standards, relevant dates (certificate expiry, test date), and any flags or missing information.`;
const EXTRACT_PROMPT = "Extract the key information-security facts from this document.";

/** Best-effort extraction of one upload. PDFs → Claude document reader; text
 *  inline; other formats stored for manual review. Never throws. */
export async function extractUpload(db: DB, uploadId: string): Promise<void> {
  const { data: row } = await db
    .from("onboarding_uploads")
    .select("id, storage_path, content_type, filename")
    .eq("id", uploadId)
    .maybeSingle();
  if (!row) return;
  const r = row as { storage_path: string; content_type: string | null; filename: string | null };

  let extracted: UploadExtraction;
  try {
    const dl = await db.storage.from(UPLOAD_BUCKET).download(r.storage_path);
    if (dl.error || !dl.data) throw new Error("could not download the file");
    const buf = Buffer.from(await dl.data.arrayBuffer());
    // extractRawText handles pdf / docx / txt / md (throws on other formats).
    const text = (await extractRawText(buf, r.filename ?? "file")).slice(0, 18_000);
    if (!text.trim()) {
      extracted = { document_type: r.content_type || "unknown", summary: "No readable text could be extracted — stored for manual review.", key_points: [], security_controls: [], dates: [], flags: [] };
    } else {
      extracted = await generateStructured({ system: EXTRACT_SYSTEM, user: `${EXTRACT_PROMPT}\n\n---\n${text}`, schema: extractSchema, effort: "low", maxTokens: 1500 });
    }
  } catch (e) {
    extracted = { document_type: r.content_type || "unknown", summary: `Stored for manual review — ${(e as Error).message}`, key_points: [], security_controls: [], dates: [], flags: [], error: (e as Error).message };
  }

  await db.from("onboarding_uploads").update({ extracted, extracted_at: new Date().toISOString() }).eq("id", uploadId);
}

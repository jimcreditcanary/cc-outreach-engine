// Step 7 — UBO document-upload requests. When a beneficial owner's ID&V / PEP
// check fails, ops shares a per-UBO link (no email); the UBO uploads a passport
// + proof of address. The unguessable token is the credential (migration 069).

import { randomBytes } from "node:crypto";
import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

export interface UboDocRequest {
  id: string;
  case_id: string;
  ubo_kyc_id: string | null;
  ubo_name: string | null;
  token: string;
  reason: string | null;
}

const COLS = "id, case_id, ubo_kyc_id, ubo_name, token, reason";

/** The public upload URL (branded host, same base as the merchant form). */
export function uboUploadUrl(token: string): string {
  const base = process.env.ONBOARDING_FORM_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  return `${base.replace(/\/$/, "")}/u/${encodeURIComponent(token)}`;
}

/** Find (or create) the doc-upload request for a UBO, keyed by name so the link
 *  is stable across resubmissions. Best-effort before migration 069. */
export async function ensureUboDocRequest(
  db: DB, caseId: string, opts: { uboKycId?: string | null; uboName: string | null; reason?: string },
): Promise<UboDocRequest | null> {
  const name = (opts.uboName ?? "").trim();
  if (!name) return null;
  try {
    const { data: existing } = await db
      .from("onboarding_ubo_doc_requests").select(COLS)
      .eq("case_id", caseId).eq("ubo_name", name).maybeSingle();
    if (existing) {
      const e = existing as UboDocRequest;
      if (opts.uboKycId || opts.reason) {
        await db.from("onboarding_ubo_doc_requests")
          .update({ ubo_kyc_id: opts.uboKycId ?? e.ubo_kyc_id, reason: opts.reason ?? e.reason })
          .eq("id", e.id);
      }
      return e;
    }
    const token = randomBytes(24).toString("base64url");
    const { data } = await db
      .from("onboarding_ubo_doc_requests")
      .insert({ case_id: caseId, ubo_kyc_id: opts.uboKycId ?? null, ubo_name: name, token, reason: opts.reason ?? null })
      .select(COLS).single();
    return (data as UboDocRequest | null) ?? null;
  } catch {
    return null;
  }
}

/** Resolve the case + UBO behind an upload token (the public page's credential). */
export async function getUboRequestByToken(db: DB, token: string): Promise<UboDocRequest | null> {
  const t = token.trim();
  if (!t) return null;
  try {
    const { data } = await db.from("onboarding_ubo_doc_requests").select(COLS).eq("token", t).maybeSingle();
    return (data as UboDocRequest | null) ?? null;
  } catch {
    return null;
  }
}

/** All doc requests for a case, keyed by ubo_name (for the review page). */
export async function loadUboDocRequests(db: DB, caseId: string): Promise<Map<string, UboDocRequest>> {
  const map = new Map<string, UboDocRequest>();
  try {
    const { data } = await db.from("onboarding_ubo_doc_requests").select(COLS).eq("case_id", caseId);
    for (const r of (data as UboDocRequest[] | null) ?? []) if (r.ubo_name) map.set(r.ubo_name, r);
  } catch {
    /* degrade */
  }
  return map;
}

export interface UboDoc { id: string; kind: string; filename: string | null; ubo_ref: string | null; created_at: string }

/** Uploaded UBO identity documents (passport / proof of address) for a case. */
export async function loadUboDocs(db: DB, caseId: string): Promise<UboDoc[]> {
  try {
    const { data } = await db
      .from("onboarding_uploads")
      .select("id, kind, filename, ubo_ref, created_at")
      .eq("case_id", caseId)
      .in("kind", ["ubo_passport", "ubo_poa"])
      .order("created_at", { ascending: true });
    return (data as UboDoc[] | null) ?? [];
  } catch {
    return [];
  }
}

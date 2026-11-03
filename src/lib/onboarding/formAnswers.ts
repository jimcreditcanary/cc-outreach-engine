// Step 6 questionnaire answer store (migration 067). One row per field in
// onboarding_form_answers = per-field attribution + autosave + "don't know".
// The long-tail questionnaire lives here; sensitive/typed data (bank accounts,
// UBO KYC, uploads) stays in its own tables. Everything degrades to empty (never
// throws) so the form keeps working before the migration is applied.

import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

/** Who is editing — captured for per-field attribution (self-identified on the
 *  shared form link; not a security credential). */
export interface FormEditor {
  email: string | null;
  role: string | null;
}

export interface AnswerValue {
  value: string;
  is_unknown: boolean;
  updated_by_email: string | null;
  updated_by_role: string | null;
  updated_at: string;
}
export type AnswerMap = Record<string, AnswerValue>;

export interface AnswerInput {
  field_key: string;
  value: string;
  is_unknown?: boolean;
}

/** The brief's per-field marker: "Updated on {date} by {email} ({role})".
 *  Returns null when there's nothing to attribute. */
export function attributionLine(a: Pick<AnswerValue, "updated_by_email" | "updated_by_role" | "updated_at"> | undefined | null): string | null {
  if (!a || !a.updated_at) return null;
  const who = a.updated_by_email || "someone";
  const role = a.updated_by_role ? ` (${a.updated_by_role})` : "";
  const d = new Date(a.updated_at);
  const date = Number.isNaN(d.getTime())
    ? a.updated_at
    : d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `Updated ${date} by ${who}${role}`;
}

/** All saved answers for a case, keyed by field_key. Empty before migration 067. */
export async function getAnswers(db: DB, caseId: string): Promise<AnswerMap> {
  try {
    const { data } = await db
      .from("onboarding_form_answers")
      .select("field_key, value, is_unknown, updated_by_email, updated_by_role, updated_at")
      .eq("case_id", caseId);
    const map: AnswerMap = {};
    for (const r of (data as (AnswerValue & { field_key: string })[] | null) ?? []) {
      map[r.field_key] = {
        value: r.value ?? "",
        is_unknown: !!r.is_unknown,
        updated_by_email: r.updated_by_email ?? null,
        updated_by_role: r.updated_by_role ?? null,
        updated_at: r.updated_at,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/** Upsert one field's answer with attribution. Best-effort before migration 067. */
export async function setAnswer(
  db: DB, caseId: string, field_key: string, value: string,
  opts: { is_unknown?: boolean; editor?: FormEditor } = {},
): Promise<void> {
  await setAnswers(db, caseId, [{ field_key, value, is_unknown: opts.is_unknown }], opts.editor);
}

/** Upsert many fields in one go (a page save). Best-effort before migration 067. */
export async function setAnswers(db: DB, caseId: string, entries: AnswerInput[], editor?: FormEditor): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const rows = entries.map((e) => ({
    case_id: caseId,
    field_key: e.field_key,
    value: e.value,
    is_unknown: e.is_unknown ?? false,
    updated_by_email: editor?.email ?? null,
    updated_by_role: editor?.role ?? null,
    updated_at: now,
  }));
  try {
    await db.from("onboarding_form_answers").upsert(rows, { onConflict: "case_id,field_key" });
  } catch {
    /* best-effort — the form still advances on in-page values before 067 */
  }
}

// ─── Per-page progress ──────────────────────────────────────────────────────────

export interface PageProgress {
  page: string;
  completed: boolean;
  completed_at: string | null;
}

/** Completed-page set for a case. Empty before migration 067. */
export async function getProgress(db: DB, caseId: string): Promise<Set<string>> {
  try {
    const { data } = await db
      .from("onboarding_form_progress")
      .select("page, completed")
      .eq("case_id", caseId)
      .eq("completed", true);
    return new Set(((data as { page: string }[] | null) ?? []).map((r) => r.page));
  } catch {
    return new Set();
  }
}

/** Mark a page complete (Continue) or not (Save-and-Continue). Best-effort. */
export async function setPageComplete(db: DB, caseId: string, page: string, completed: boolean): Promise<void> {
  try {
    await db.from("onboarding_form_progress").upsert(
      { case_id: caseId, page, completed, completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
      { onConflict: "case_id,page" },
    );
  } catch {
    /* best-effort */
  }
}

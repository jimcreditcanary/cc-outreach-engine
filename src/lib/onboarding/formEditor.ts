// Self-identify for the shared customer onboarding link (P0). The token is the
// credential; this just records WHO is filling the form in, for per-field
// attribution ("updated by {email} ({role})"). Stored in a cookie scoped to the
// case — not a security boundary, just an identity for the audit trail.

import { cookies } from "next/headers";

export interface FormEditorIdentity {
  case_id: string;
  contact_id: string | null;
  name: string;
  email: string | null;
  role: string | null; // human label, e.g. "Procurement"
}

const COOKIE = "mf_editor";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

/** The self-identified editor for this case, if they've picked who they are. */
export async function getFormEditor(caseId: string): Promise<FormEditorIdentity | null> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FormEditorIdentity;
    return parsed.case_id === caseId ? parsed : null;
  } catch {
    return null;
  }
}

export async function setFormEditor(identity: FormEditorIdentity): Promise<void> {
  try {
    (await cookies()).set(COOKIE, JSON.stringify(identity), {
      httpOnly: true, sameSite: "lax", path: "/m", maxAge: MAX_AGE,
    });
  } catch {
    /* no-op */
  }
}

export async function clearFormEditor(): Promise<void> {
  try {
    (await cookies()).delete(COOKIE);
  } catch {
    /* no-op */
  }
}

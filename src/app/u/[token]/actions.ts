"use server";

// Public submit for the UBO document-upload form. No auth - the unguessable
// token is the credential. Stores the passport + proof of address against the
// case, tied to the UBO by name.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getUboRequestByToken } from "@/lib/onboarding/uboDocs";
import { saveUpload } from "@/lib/onboarding/uploads";
import { logCaseEvent } from "@/lib/onboarding/cases";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function uploadUboDocsAction(formData: FormData) {
  const token = str(formData.get("token"));
  const back = `/u/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const req = await getUboRequestByToken(db, token);
  if (!req) redirect(`${back}?error=token`);
  const ref = req.ubo_name ?? undefined;

  let saved = 0;
  let failed = false;
  try {
    for (const [fieldName, kind] of [["passport", "ubo_passport"], ["poa", "ubo_poa"]] as const) {
      const files = formData.getAll(fieldName).filter((f): f is File => f instanceof File && f.size > 0);
      for (const f of files.slice(0, 2)) {
        if (f.size > 20 * 1024 * 1024) continue;
        await saveUpload(db, req.case_id, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }, kind, ref);
        saved++;
      }
    }
  } catch (e) {
    console.error(`[ubo-docs] upload failed for case ${req.case_id}:`, e);
    failed = true;
  }
  if (failed) redirect(`${back}?error=save`);
  if (saved > 0) await logCaseEvent(db, req.case_id, "ubo_docs_uploaded", { id: null, email: "ubo" }, { ubo: req.ubo_name, count: saved });
  redirect(`${back}?done=1`);
}

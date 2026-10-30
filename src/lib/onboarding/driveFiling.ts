// Phase 5c — file an onboarding case into Google Drive. Creates (once) a per-case
// folder tree under the configured root — "<Company> — Onboarding" with
// Onboarding Forms / Supporting Docs / Project Management subfolders, stored on
// the case (drive_*_folder_id) — then uploads the generated documents (→ Forms)
// and the merchant's infosec uploads (→ Supporting Docs). Mock until a service
// account + root folder are set, so the action runs end-to-end meanwhile.

import type { serviceClient } from "../db/client";
import { getDrive } from "../integrations/drive";
import { downloadGeneratedDoc, loadGeneratedDocs } from "./docgen";
import { logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;
const BUCKET = "onboarding-uploads";

interface CaseDrive {
  company_number: string | null;
  drive_folder_id: string | null;
  drive_onboarding_forms_folder_id: string | null;
  drive_supporting_docs_folder_id: string | null;
  drive_project_mgmt_folder_id: string | null;
}

export interface DriveFilingResult { folderUrl: string | null; filed: number; createdFolders: boolean }

export async function fileCaseToDrive(db: DB, caseId: string, actor: { id?: string | null; email?: string | null }): Promise<DriveFilingResult> {
  const { data } = await db
    .from("onboarding_cases")
    .select("company_number, drive_folder_id, drive_onboarding_forms_folder_id, drive_supporting_docs_folder_id, drive_project_mgmt_folder_id")
    .eq("id", caseId)
    .maybeSingle();
  const c = data as CaseDrive | null;
  if (!c) throw new Error("Case not found.");

  const drive = getDrive();
  let createdFolders = false;
  let mainFolderUrl: string | null = null;
  let formsFolderId = c.drive_onboarding_forms_folder_id;
  let supportingFolderId = c.drive_supporting_docs_folder_id;

  // Create the folder tree once.
  if (!c.drive_folder_id || !formsFolderId) {
    const label = c.company_number ? `Company ${c.company_number}` : `Case ${caseId.slice(0, 8)}`;
    const main = await drive.createFolder(`${label} — Onboarding`, drive.rootFolderId());
    const [forms, supporting, pm] = await Promise.all([
      drive.createFolder("Onboarding Forms", main.id),
      drive.createFolder("Supporting Docs", main.id),
      drive.createFolder("Project Management", main.id),
    ]);
    formsFolderId = forms.id;
    supportingFolderId = supporting.id;
    mainFolderUrl = main.url;
    createdFolders = true;
    await db.from("onboarding_cases").update({
      drive_folder_id: main.id,
      drive_onboarding_forms_folder_id: forms.id,
      drive_supporting_docs_folder_id: supporting.id,
      drive_project_mgmt_folder_id: pm.id,
    }).eq("id", caseId);
  } else {
    mainFolderUrl = `https://drive.google.com/drive/folders/${c.drive_folder_id}`;
  }

  let filed = 0;

  // Generated documents → Onboarding Forms.
  const docs = await loadGeneratedDocs(db, caseId);
  for (const d of docs) {
    const file = await downloadGeneratedDoc(db, d.id);
    if (!file || !formsFolderId) continue;
    await drive.uploadFile({ name: file.filename, parentId: formsFolderId, mimeType: file.contentType, bytes: file.bytes });
    filed++;
  }

  // Merchant infosec uploads → Supporting Docs.
  if (supportingFolderId) {
    const { data: ups } = await db.from("onboarding_uploads").select("filename, storage_path, content_type").eq("case_id", caseId);
    for (const u of (ups as { filename: string | null; storage_path: string; content_type: string | null }[] | null) ?? []) {
      try {
        const dl = await db.storage.from(BUCKET).download(u.storage_path);
        if (dl.error || !dl.data) continue;
        const bytes = Buffer.from(await dl.data.arrayBuffer());
        await drive.uploadFile({ name: u.filename ?? "document", parentId: supportingFolderId, mimeType: u.content_type ?? "application/octet-stream", bytes });
        filed++;
      } catch { /* skip a bad upload */ }
    }
  }

  await logCaseEvent(db, caseId, "drive_filed", actor, { filed, createdFolders });
  return { folderUrl: mainFolderUrl, filed, createdFolders };
}

/** The Drive folder link for a case, if filed. */
export async function caseDriveFolderUrl(db: DB, caseId: string): Promise<string | null> {
  try {
    const { data } = await db.from("onboarding_cases").select("drive_folder_id").eq("id", caseId).maybeSingle();
    const id = (data as { drive_folder_id: string | null } | null)?.drive_folder_id;
    return id ? `https://drive.google.com/drive/folders/${id}` : null;
  } catch {
    return null;
  }
}

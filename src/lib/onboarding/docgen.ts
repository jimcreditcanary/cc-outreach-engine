// Phase 5 — generate the onboarding documents by filling the branded templates
// (src/lib/onboarding/templates/) with the case + CH-enrichment + merchant-form
// data. docx via docxtemplater (loops for directors/PSCs/UBOs); xlsx via SheetJS
// (flat {tag} cell replacement). Which docs are produced follows the product
// groups (documentsFor). Files land in the private 'onboarding-uploads' bucket
// under generated/, recorded in onboarding_generated_docs (regenerate replaces).
//
// Tags map 1:1 to TEMPLATE-TAGS.md. Anything unmapped renders blank (nullGetter)
// — the templates intentionally leave merchant-/TU-completed fields empty.

import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import * as XLSX from "xlsx";
import type { serviceClient } from "../db/client";
import { getCase, logCaseEvent } from "./cases";
import { loadMerchantForm } from "./merchantForm";
import { documentsFor, type OnboardingDocKind } from "./productGroups";

type DB = ReturnType<typeof serviceClient>;
const BUCKET = "onboarding-uploads";
const TPL_DIR = path.join(process.cwd(), "src", "lib", "onboarding", "templates");

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSXT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface DocSpec { template: string; kind: "docx" | "xlsx"; contentType: string; out: string }
const DOCS: Record<OnboardingDocKind, DocSpec> = {
  tu_credit_eua:          { template: "tu-credit-eua.template.docx",   kind: "docx", contentType: DOCX,  out: "TU Credit EUA.docx" },
  tu_monevo_eua:          { template: "tu-monevo-eua.template.docx",   kind: "docx", contentType: DOCX,  out: "TU Monevo EUA.docx" },
  tu_due_diligence_xlsx:  { template: "tu-due-diligence.template.xlsx", kind: "xlsx", contentType: XLSXT, out: "TU Due Diligence.xlsx" },
  merchant_onboarding_form:{ template: "merchant-form.template.docx",  kind: "docx", contentType: DOCX,  out: "Merchant Onboarding Form.docx" },
  dd_questionnaire:       { template: "dd-questionnaire.template.docx", kind: "docx", contentType: DOCX,  out: "DD Questionnaire.docx" },
};

// ─── data assembly ──────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));

function fmtAddr(a: Rec | null | undefined): string {
  if (!a) return "";
  return ["premises", "address_line_1", "address_line_2", "locality", "region", "postal_code", "country"]
    .map((k) => s(a[k]).trim()).filter(Boolean).join(", ");
}
function regClause(companyType: string | null): string {
  const t = (companyType ?? "").toLowerCase();
  if (t.includes("industrial") || t.includes("provident") || t.includes("registered-society") || t.includes("royal-charter")) {
    return "as an industrial and provident society with registration number";
  }
  return "with company number";
}
function dob(month: unknown, year: unknown, full?: string | null): string {
  if (full) return full;
  if (month || year) return `${month ?? "?"}/${year ?? "?"}`;
  return "";
}
function officerDetail(o: Rec): string {
  return [
    o.dob_month || o.dob_year ? `DOB ${dob(o.dob_month, o.dob_year)}` : "",
    s(o.nationality),
    o.appointed_on ? `appointed ${s(o.appointed_on)}` : "",
    o.resigned_on ? `resigned ${s(o.resigned_on)}` : "current",
    "identity verification pending",
  ].filter(Boolean).join(" · ");
}

async function buildData(db: DB, caseId: string): Promise<Rec> {
  const c = await getCase(db, caseId);
  const [{ data: snap }, { data: offs }, { data: ubos }, { form }] = await Promise.all([
    db.from("onboarding_company_snapshot").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("onboarding_officers").select("name, officer_role, appointed_on, resigned_on, nationality, dob_month, dob_year").eq("case_id", caseId),
    db.from("onboarding_ubos").select("name, is_corporate, nationality, country_of_residence, dob_month, dob_year, natures_of_control").eq("case_id", caseId),
    loadMerchantForm(db, caseId),
  ]);
  const snapshot = (snap as Rec | null) ?? {};
  const officers = (offs as Rec[] | null) ?? [];
  const uboRows = ((ubos as Rec[] | null) ?? []).filter((u) => !u.is_corporate && u.name);
  const business = form?.business ?? {};
  const comp = form?.compliance ?? {};
  const sig = form?.signatory ?? {};

  // KYC (merchant-completed) by name, for ownership % + full DOB.
  const { data: kycRows } = await db.from("onboarding_ubo_kyc").select("ubo_name, date_of_birth, exact_ownership_percent").eq("case_id", caseId);
  const kycByName = new Map<string, Rec>();
  for (const k of (kycRows as Rec[] | null) ?? []) kycByName.set(s(k.ubo_name), k);

  const activeOfficers = officers.filter((o) => !o.resigned_on);
  const firstUbo = uboRows[0];

  const accountsLine = snapshot.accounts_overdue ? "OVERDUE" : snapshot.accounts_next_due ? `next due ${s(snapshot.accounts_next_due)}` : "—";
  const csLine = snapshot.confirmation_statement_overdue ? "OVERDUE" : snapshot.confirmation_statement_next_due ? `next due ${s(snapshot.confirmation_statement_next_due)}` : "—";

  return {
    // core / shared
    client_legal_name: s(snapshot.company_name) || s(business.trading_name),
    client_trading_name: s(business.trading_name),
    client_reg_number: s(c?.company_number),
    client_reg_clause: regClause(s(snapshot.company_type) || null),
    client_company_type: s(snapshot.company_type),
    client_status: s(snapshot.company_status),
    client_registered_office: fmtAddr(snapshot.registered_office as Rec),
    client_principal_office: s(business.principal_office),
    client_trading_address: s(business.trading_address),
    client_phone: s(business.phone),
    client_email: s(business.email),
    client_website: s(business.website),
    client_sic_code: Array.isArray(snapshot.sic_codes) ? (snapshot.sic_codes as string[]).join(", ") : "",
    client_accounts_filing: accountsLine,
    client_confirmation_statement: csLine,
    client_charges: snapshot.has_charges ? "Yes" : "None on file",
    client_insolvency: snapshot.has_insolvency_history ? "Yes" : "None",
    client_ico_number: s(comp.ico_number),
    client_fca_frn: s(comp.fca_frn),
    client_dpo: s(comp.dpo),
    client_privacy_policy_url: s(comp.privacy_policy_url),
    client_trade_body: s(comp.trade_body),
    signatory_name: s(sig.name),
    signatory_title: s(sig.title),
    signatory_email: s(sig.email),
    agreement_version: "",
    // people loops
    directors: activeOfficers.map((o) => ({ director_name: s(o.name), director_details: officerDetail(o) })),
    psc_name: s(firstUbo?.name),
    psc_details: firstUbo ? [s(firstUbo.nationality), s(firstUbo.country_of_residence), Array.isArray(firstUbo.natures_of_control) ? (firstUbo.natures_of_control as string[]).map((n) => n.replace(/-/g, " ")).join("; ") : ""].filter(Boolean).join(" · ") : "",
    historic_pscs: "",
    ubo_conclusions: uboRows.map((u) => ({ ubo_conclusion_name: s(u.name), ubo_conclusion_assessment: "To verify via ID&V + PEP screening" })),
    attributable_ownership: uboRows.map((u) => ({ ao_name: s(u.name), ao_detail: s(kycByName.get(s(u.name))?.exact_ownership_percent) || "per declaration" })),
    ubos: uboRows.map((u) => {
      const k = kycByName.get(s(u.name));
      return {
        ubo_full_name: s(u.name),
        ubo_dob: dob(u.dob_month, u.dob_year, s(k?.date_of_birth) || null),
        ubo_nationality: s(u.nationality),
        ubo_country: s(u.country_of_residence),
      };
    }),
  };
}

// ─── rendering ───────────────────────────────────────────────────────────────────

async function renderDocx(templatePath: string, data: Rec): Promise<Buffer> {
  const buf = await fs.readFile(templatePath);
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function renderXlsx(buf: Buffer, data: Rec): Buffer {
  const wb = XLSX.read(buf, { type: "buffer" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const cell = (ws as Rec)[addr] as { v?: unknown; w?: unknown };
      if (cell && typeof cell.v === "string" && cell.v.includes("{")) {
        cell.v = cell.v.replace(/\{(\w+)\}/g, (_m, tag: string) => s(data[tag]));
        delete cell.w;
      }
    }
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export interface GeneratedDoc { id: string; doc_kind: string; filename: string; generated_at: string }

export async function loadGeneratedDocs(db: DB, caseId: string): Promise<GeneratedDoc[]> {
  try {
    const { data } = await db.from("onboarding_generated_docs").select("id, doc_kind, filename, generated_at").eq("case_id", caseId).order("doc_kind");
    return (data as GeneratedDoc[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Generate every document the case's product groups call for. Replaces any
 *  prior set. Returns the number generated. */
export async function generateDocsForCase(db: DB, caseId: string, actor: { id?: string | null; email?: string | null }): Promise<{ generated: number; kinds: OnboardingDocKind[] }> {
  const c = await getCase(db, caseId);
  if (!c) throw new Error("Case not found.");
  const kinds = documentsFor(c.product_groups);
  if (kinds.length === 0) throw new Error("No documents apply to this product selection.");

  const data = await buildData(db, caseId);
  await db.from("onboarding_generated_docs").delete().eq("case_id", caseId);

  for (const kind of kinds) {
    const spec = DOCS[kind];
    const tplPath = path.join(TPL_DIR, spec.template);
    let out: Buffer;
    if (spec.kind === "docx") {
      out = await renderDocx(tplPath, data);
    } else {
      out = renderXlsx(await fs.readFile(tplPath), data);
    }
    const storagePath = `${caseId}/generated/${kind}-${spec.out}`;
    const up = await db.storage.from(BUCKET).upload(storagePath, out, { contentType: spec.contentType, upsert: true });
    if (up.error) throw up.error;
    const ins = await db.from("onboarding_generated_docs").insert({
      case_id: caseId, doc_kind: kind, filename: spec.out, storage_path: storagePath, content_type: spec.contentType,
    });
    if (ins.error) throw ins.error;
  }

  await logCaseEvent(db, caseId, "docs_generated", actor, { kinds });
  await db.from("onboarding_cases").update({ status: "docs_generated" }).eq("id", caseId);
  return { generated: kinds.length, kinds };
}

/** Download a generated doc's bytes (for the authed download route). */
export async function downloadGeneratedDoc(db: DB, docId: string): Promise<{ bytes: Buffer; filename: string; contentType: string } | null> {
  const { data } = await db.from("onboarding_generated_docs").select("storage_path, filename, content_type").eq("id", docId).maybeSingle();
  const row = data as { storage_path: string; filename: string; content_type: string | null } | null;
  if (!row) return null;
  const dl = await db.storage.from(BUCKET).download(row.storage_path);
  if (dl.error || !dl.data) return null;
  return { bytes: Buffer.from(await dl.data.arrayBuffer()), filename: row.filename, contentType: row.content_type ?? "application/octet-stream" };
}

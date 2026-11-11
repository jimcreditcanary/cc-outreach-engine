// The Due Diligence Pack — a single Word document that consolidates EVERYTHING
// captured for an onboarding case into one reviewable/filable evidence pack:
//   • entity + Companies House snapshot
//   • the resolved ownership structure (corporate chain + individual UBOs)
//   • directors, beneficial-owner KYC (with the passport / proof-of-address
//     images embedded), identity & screening results
//   • business & compliance, the full payment / direct-debit / infosec / policy
//     questionnaires, bank accounts, privacy assessment, infosec uploads
//   • the Companies House incorporation (IN01) and filed accounts, their pages
//     rendered in as images
//
// Built programmatically with `docx` (not a template) because it has to embed
// images and lay out sections that only exist when the relevant data is present.
// Image rendering (PDF pages, photo normalisation) lives in ./imaging.

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ImageRun, AlignmentType, type IBorderOptions,
} from "docx";
import type { serviceClient } from "../db/client";
import { getCase } from "./cases";
import { loadMerchantForm } from "./merchantForm";
import { getAnswers, type AnswerMap } from "./formAnswers";
import { loadUboChecks } from "./uboChecks";
import { loadPrivacyAssessment } from "./privacyAssessment";
import { loadAccounts } from "./accounts";
import { UPLOAD_BUCKET, UBO_ID_KIND, UBO_PROOF_KIND } from "./uploads";
import { parsePersonName, nameMatchKey } from "./personName";
import { productLabel } from "../../app/m/[token]/fields";
import {
  INFOSEC_SMALL, INFOSEC_LARGE, POLICY_QUESTIONS,
} from "../../app/m/[token]/fields";
import { getCompaniesHouse } from "../integrations/companiesHouse";
import { prepareEmbeddableImage, pdfToImages, pdfPageCount, type PreparedImage } from "./imaging";

type DB = ReturnType<typeof serviceClient>;
type Rec = Record<string, unknown>;

const NAVY = "003566";
const GREY = "6B7280";
const LIGHT = "F3F4F6";
const LINE = "D1D5DB";

const s = (v: unknown): string => (v == null ? "" : String(v));
const titleCase = (v: string) => v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ─── docx building blocks ────────────────────────────────────────────────────

const thinBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 2, color: LINE };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function run(text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) {
  return new TextRun({ text, bold: opts.bold, italics: opts.italics, color: opts.color, size: opts.size ?? 20 });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 4 } },
    children: [run(text, { bold: true, color: NAVY, size: 30 })],
  });
}
function h2(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 200, after: 80 }, children: [run(text, { bold: true, color: NAVY, size: 24 })] });
}
function body(text: string, opts: { color?: string; italics?: boolean; indent?: number; bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [run(text, { color: opts.color, italics: opts.italics, bold: opts.bold })],
  });
}
function muted(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 60 }, children: [run(text, { color: GREY, italics: true })] });
}

function cell(content: string | Paragraph[], opts: { bold?: boolean; shade?: string; width?: number } = {}): TableCell {
  const paras = Array.isArray(content) ? content : [new Paragraph({ children: [run(content, { bold: opts.bold })] })];
  return new TableCell({
    children: paras.length ? paras : [new Paragraph({ children: [run("—", { color: GREY })] })],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { fill: opts.shade } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
  });
}

/** A label/value table. Rows whose value is blank are dropped. Returns [] when
 *  nothing survives (caller can skip the whole section). */
function kv(rows: [string, string][]): (Table | Paragraph)[] {
  const keep = rows.filter(([, v]) => s(v).trim());
  if (!keep.length) return [];
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [3300, 6400],
    rows: keep.map(([k, v]) => new TableRow({ children: [
      cell(k, { bold: true, shade: LIGHT, width: 34 }),
      cell([new Paragraph({ children: [run(v)] })], { width: 66 }),
    ] })),
    borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder, insideHorizontal: thinBorder, insideVertical: thinBorder },
  })];
}

/** A yes/no/text questionnaire as a two-column table (question → answer). Only
 *  answered questions are shown. `extra` appends per-question detail lines. */
function qaTable(items: { q: string; a: string; note?: string }[]): (Table | Paragraph)[] {
  const keep = items.filter((i) => s(i.a).trim());
  if (!keep.length) return [];
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [6800, 2900],
    rows: keep.map((i) => new TableRow({ children: [
      cell([
        new Paragraph({ children: [run(i.q)] }),
        ...(i.note ? [new Paragraph({ children: [run(i.note, { color: GREY, italics: true, size: 18 })] })] : []),
      ], { width: 70 }),
      cell([new Paragraph({ children: [run(titleCase(i.a), { bold: true })] })], { width: 30 }),
    ] })),
    borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder, insideHorizontal: thinBorder, insideVertical: thinBorder },
  })];
}

function image(img: PreparedImage, displayWidth: number): Paragraph {
  const h = Math.round(displayWidth * (img.height / Math.max(img.width, 1)));
  return new Paragraph({
    spacing: { before: 60, after: 120 },
    children: [new ImageRun({ data: img.data, transformation: { width: displayWidth, height: h }, type: img.type })],
  });
}

// ─── field label maps (readable questionnaire output) ────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  pay_take_payments_for: "What payments are taken for",
  pay_bank_statement: "Recent bank statement provided",
  pay_bank_statement_reason: "Reason (if no statement)",
  pay_expected_volume: "Expected monthly volume (count)",
  pay_avg_value: "Average transaction value",
  pay_max_value: "Maximum transaction value",
  pay_b2b_b2c: "Customer base (B2B / B2C)",
  pay_b2b_pct: "B2B %",
  pay_b2c_pct: "B2C %",
  pay_collect_method: "How payments are collected / provider",
};
const DD_LABELS: Record<string, string> = {
  dd_has_sun: "Has an active SUN",
  dd_sun_number: "SUN",
  dd_sun_provider: "SUN provider",
  dd_branded_sun_ok: "Branded SUN acceptable",
  dd_statement_display: "Statement display name",
  dd_transfer: "Direct Debit transfer",
  dd_max_collection_limit: "Max collection per customer / month",
  dd_frequency: "Collection frequency",
  dd_frequency_other: "Frequency (other)",
  dd_frequency_split: "Frequency split",
  dd_before_after: "Collect before / after service",
  dd_schedule: "Schedule type",
  dd_collection_dates: "Collection date(s)",
  dd_advance_notice: "Advance-notice method",
  dd_auto_represent: "Auto-representment",
  dd_gift_aid: "Gift Aid",
  dd_signup: "Sign-up method",
};
const INFOSEC_TOP_LABELS: Record<string, string> = {
  infosec_cmc_pi: "A Claims Management / Personal Injury firm?",
  infosec_search_type_ok: "Search type in keeping with the business?",
  infosec_shared_email: "Uses a shared email account?",
  infosec_ico_notice: "Subject to an ICO enforcement / decision notice?",
  infosec_data_transfer: "Transfers data outside the UK / EEA?",
  infosec_industry_body: "Industry-body membership required?",
  infosec_membership_valid: "Membership valid & current?",
  infosec_iso27001: "ISO 27001 certified?",
  infosec_pci: "PCI DSS certified?",
  infosec_soc2: "SOC 2 certified?",
  infosec_iso27001_intending: "Intending to certify ISO 27001?",
  infosec_align_other: "Other security arrangements in place?",
  infosec_over_10: "More than 10 employees?",
};

// ─── data assembly ───────────────────────────────────────────────────────────

interface UboNode {
  id: string; parent_id: string | null; depth: number; via_company_number: string | null;
  kind: string | null; is_corporate: boolean; name: string | null;
  natures_of_control: string[] | null; ceased_on: string | null;
  nationality: string | null; country_of_residence: string | null;
  identification: Rec | null;
}

function fmtAddr(a: Rec | null | undefined): string {
  if (!a) return "";
  return ["premises", "line1", "address_line_1", "address_line_2", "line2", "locality", "city", "region", "postal_code", "postcode", "country"]
    .map((k) => s((a as Rec)[k]).trim()).filter(Boolean).join(", ");
}
function natures(list: string[] | null | undefined): string {
  return (list ?? []).map((n) => n.replace(/-/g, " ").replace(/\bpercent\b/g, "%")).join("; ");
}

export interface PackData {
  caseId: string;
  companyNumber: string | null;
  productGroups: string[];
  snapshot: Rec;
  officers: Rec[];
  ubos: UboNode[];
  form: { business: Rec; compliance: Rec; signatory: Rec; submitted_at: string | null } | null;
  kyc: Rec[];
  answers: AnswerMap;
  bankAccounts: Rec[];
  directDebit: Rec | null;
  uploads: { id: string; filename: string | null; content_type: string | null; size_bytes: number | null; extracted: Rec | null }[];
  uboChecks: Rec[];
  privacy: Rec | null;
  accounts: Rec | null;
  uboImages: { ubo_ref: string | null; kind: string; filename: string | null; content_type: string | null; img: PreparedImage | null }[];
}

export async function buildPackData(db: DB, caseId: string): Promise<PackData> {
  const c = await getCase(db, caseId);
  const [{ data: snap }, { data: offs }, { data: ubos }, mf, answers, { data: uploadRows }, uboChecks, privacy, accounts, { data: imgRows }] = await Promise.all([
    db.from("onboarding_company_snapshot").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("onboarding_officers").select("name, officer_role, appointed_on, resigned_on, nationality, dob_month, dob_year, country_of_residence").eq("case_id", caseId).order("resigned_on", { ascending: true, nullsFirst: true }),
    db.from("onboarding_ubos").select("id, parent_id, depth, via_company_number, kind, is_corporate, name, natures_of_control, ceased_on, nationality, country_of_residence, identification").eq("case_id", caseId).order("depth", { ascending: true }),
    loadMerchantForm(db, caseId),
    getAnswers(db, caseId),
    db.from("onboarding_uploads").select("id, filename, content_type, size_bytes, extracted, kind").eq("case_id", caseId).order("created_at", { ascending: true }),
    loadUboChecks(db, caseId).catch(() => []),
    loadPrivacyAssessment(db, caseId).catch(() => null),
    loadAccounts(db, caseId).catch(() => null),
    db.from("onboarding_uploads").select("ubo_ref, kind, filename, content_type, storage_path").eq("case_id", caseId).in("kind", [UBO_ID_KIND, UBO_PROOF_KIND]),
  ]);
  // Supporting documents list excludes the KYC images (shown with the owners).
  const uploads = (((uploadRows as Rec[] | null) ?? [])
    .filter((u) => ![UBO_ID_KIND, UBO_PROOF_KIND].includes(s(u.kind)))
    .map((u) => ({ id: s(u.id), filename: (u.filename as string) ?? null, content_type: (u.content_type as string) ?? null, size_bytes: (u.size_bytes as number) ?? null, extracted: (u.extracted as Rec) ?? null }))) as PackData["uploads"];

  // Download + prepare the KYC images (passport / proof of address).
  const uboImages: PackData["uboImages"] = [];
  for (const r of ((imgRows as Rec[] | null) ?? [])) {
    let img: PreparedImage | null = null;
    try {
      const dl = await db.storage.from(UPLOAD_BUCKET).download(s(r.storage_path));
      if (dl.data) img = await prepareEmbeddableImage(Buffer.from(await dl.data.arrayBuffer()), s(r.content_type) || null, { maxWidth: 1100 });
    } catch { /* best-effort */ }
    uboImages.push({ ubo_ref: (r.ubo_ref as string) ?? null, kind: s(r.kind), filename: (r.filename as string) ?? null, content_type: (r.content_type as string) ?? null, img });
  }

  return {
    caseId,
    companyNumber: c?.company_number ?? null,
    productGroups: c?.product_groups ?? [],
    snapshot: (snap as Rec | null) ?? {},
    officers: (offs as Rec[] | null) ?? [],
    ubos: (((ubos as Rec[] | null) ?? []).map((u) => ({
      id: s(u.id), parent_id: (u.parent_id as string) ?? null, depth: Number(u.depth ?? 0),
      via_company_number: (u.via_company_number as string) ?? null, kind: (u.kind as string) ?? null,
      is_corporate: Boolean(u.is_corporate), name: (u.name as string) ?? null,
      natures_of_control: Array.isArray(u.natures_of_control) ? (u.natures_of_control as string[]) : null,
      ceased_on: (u.ceased_on as string) ?? null, nationality: (u.nationality as string) ?? null,
      country_of_residence: (u.country_of_residence as string) ?? null, identification: (u.identification as Rec) ?? null,
    }))),
    form: mf.form ? {
      business: (mf.form.business ?? {}) as unknown as Rec,
      compliance: (mf.form.compliance ?? {}) as unknown as Rec,
      signatory: (mf.form.signatory ?? {}) as unknown as Rec,
      submitted_at: mf.form.submitted_at,
    } : null,
    kyc: (mf.kyc as unknown as Rec[]) ?? [],
    answers,
    bankAccounts: (mf.bankAccounts as unknown as Rec[]) ?? [],
    directDebit: (mf.directDebit as Rec | null) ?? null,
    uploads,
    uboChecks: (uboChecks as unknown as Rec[]) ?? [],
    privacy: (privacy as unknown as Rec | null),
    accounts: (accounts as unknown as Rec | null),
    uboImages,
  };
}

// ─── ownership structure ─────────────────────────────────────────────────────

/** Render the ownership chain as an indented tree: the operating company, each
 *  direct PSC, then recursively the PSCs behind any corporate PSC. Current
 *  holdings first; ceased ones listed as historic. */
function ownershipSection(d: PackData): Paragraph[] {
  const out: Paragraph[] = [h1("Ownership structure")];
  const companyName = s(d.snapshot.company_name) || "The operating company";
  out.push(body(`${companyName}${d.companyNumber ? ` (${d.companyNumber})` : ""} — operating company`, { bold: true }));

  if (!d.ubos.length) {
    out.push(muted("No persons with significant control were returned by Companies House."));
    return out;
  }

  const kycByKey = new Map<string, Rec>();
  for (const k of d.kyc) {
    const pn = parsePersonName(s(k.ubo_name));
    kycByKey.set(nameMatchKey(pn.first, pn.last) || s(k.ubo_name).toLowerCase(), k);
  }
  const childrenOf = (id: string | null, depth: number) =>
    d.ubos.filter((u) => (u.parent_id ?? null) === id && u.depth === depth);

  const renderNode = (u: UboNode, level: number) => {
    const pn = parsePersonName(s(u.name));
    const kyc = u.is_corporate ? undefined : kycByKey.get(nameMatchKey(pn.first, pn.last) || s(u.name).toLowerCase());
    const pct = kyc?.exact_ownership_percent ? `${s(kyc.exact_ownership_percent)}%` : "";
    const tag = u.is_corporate ? "corporate" : "individual";
    const ceased = u.ceased_on ? ` — CEASED ${s(u.ceased_on)}` : "";
    const head = `${"↳ ".repeat(level > 0 ? 1 : 0)}${s(u.name) || "(unnamed)"}  ·  ${tag}${pct ? `  ·  declared ${pct}` : ""}${ceased}`;
    out.push(new Paragraph({
      spacing: { before: 80, after: 20 },
      indent: { left: 360 * (level + 1) },
      children: [run(head, { bold: !u.ceased_on, color: u.ceased_on ? GREY : undefined })],
    }));
    const detail = [
      natures(u.natures_of_control),
      u.is_corporate && u.identification ? `registered ${s(u.identification.registration_number)} (${s(u.identification.place_registered) || s(u.identification.country_registered)})` : "",
      u.nationality ? `nationality ${s(u.nationality)}` : "",
      u.country_of_residence ? `resident ${s(u.country_of_residence)}` : "",
    ].filter(Boolean).join("  ·  ");
    if (detail) out.push(new Paragraph({ indent: { left: 360 * (level + 1) + 220 }, spacing: { after: 40 }, children: [run(detail, { color: GREY, size: 18 })] }));
    // Recurse into the PSCs behind a corporate node (one depth deeper).
    for (const child of childrenOf(u.id, u.depth + 1)) renderNode(child, level + 1);
  };

  const roots = d.ubos.filter((u) => u.depth === 0 && !u.ceased_on);
  const ceasedRoots = d.ubos.filter((u) => u.depth === 0 && u.ceased_on);
  for (const r of roots) renderNode(r, 0);
  if (ceasedRoots.length) {
    out.push(body("Historic / ceased control", { bold: true }));
    for (const r of ceasedRoots) renderNode(r, 0);
  }
  return out;
}

// ─── the document ────────────────────────────────────────────────────────────

export async function renderDueDiligencePack(db: DB, caseId: string): Promise<Buffer> {
  const d = await buildPackData(db, caseId);
  const kids: (Paragraph | Table)[] = [];
  const push = (...xs: (Paragraph | Table | (Paragraph | Table)[])[]) => { for (const x of xs) Array.isArray(x) ? kids.push(...x) : kids.push(x); };

  const companyName = s(d.snapshot.company_name) || s((d.form?.business as Rec)?.trading_name) || "Merchant";

  // Title
  push(new Paragraph({ spacing: { after: 40 }, children: [run("Customer Due Diligence Pack", { bold: true, color: NAVY, size: 40 })] }));
  push(new Paragraph({ spacing: { after: 40 }, children: [run(companyName, { bold: true, size: 26 })] }));
  push(muted([
    d.companyNumber ? `Company ${d.companyNumber}` : "",
    d.productGroups.length ? `Products: ${d.productGroups.map(productLabel).join(", ")}` : "",
    d.form?.submitted_at ? `Submitted ${new Date(d.form.submitted_at).toLocaleDateString("en-GB")}` : "",
    `Generated ${new Date().toLocaleString("en-GB")}`,
  ].filter(Boolean).join("  ·  ")));

  // 1. Entity
  push(h1("Entity"));
  push(kv([
    ["Registered name", s(d.snapshot.company_name)],
    ["Trading name", s((d.form?.business as Rec)?.trading_name)],
    ["Company number", s(d.companyNumber)],
    ["Type", s(d.snapshot.company_type)],
    ["Status", s(d.snapshot.company_status)],
    ["Incorporated", s(d.snapshot.date_of_creation)],
    ["SIC code(s)", Array.isArray(d.snapshot.sic_codes) ? (d.snapshot.sic_codes as string[]).join(", ") : ""],
    ["Registered office", fmtAddr(d.snapshot.registered_office as Rec)],
    ["Trading address", s((d.form?.business as Rec)?.trading_address)],
    ["Accounts filing", d.snapshot.accounts_overdue ? "OVERDUE" : d.snapshot.accounts_next_due ? `next due ${s(d.snapshot.accounts_next_due)}` : ""],
    ["Confirmation statement", d.snapshot.confirmation_statement_overdue ? "OVERDUE" : d.snapshot.confirmation_statement_next_due ? `next due ${s(d.snapshot.confirmation_statement_next_due)}` : ""],
    ["Charges", d.snapshot.has_charges ? "Yes — see Companies House" : "None on file"],
    ["Insolvency history", d.snapshot.has_insolvency_history ? "Yes — see Companies House" : "None"],
  ]));

  // 2. Ownership structure
  push(ownershipSection(d));

  // 3. Directors
  push(h1("Directors"));
  const activeDirs = d.officers.filter((o) => !o.resigned_on);
  const resignedDirs = d.officers.filter((o) => o.resigned_on);
  if (activeDirs.length) {
    push(...kv(activeDirs.map((o) => [
      s(o.name),
      [o.dob_month || o.dob_year ? `DOB ${s(o.dob_month)}/${s(o.dob_year)}` : "", s(o.nationality), s(o.country_of_residence), o.appointed_on ? `appointed ${s(o.appointed_on)}` : ""].filter(Boolean).join(" · "),
    ] as [string, string])));
  } else push(muted("No active directors returned."));
  if (resignedDirs.length) {
    push(h2("Recently resigned (≤12 months)"));
    push(...kv(resignedDirs.map((o) => [s(o.name), `resigned ${s(o.resigned_on)}`] as [string, string])));
  }

  // 4. Beneficial owners — KYC + images
  push(h1("Beneficial owners — KYC"));
  if (!d.kyc.length) push(muted("No beneficial-owner KYC was submitted."));
  for (const k of d.kyc) {
    push(h2(s(k.ubo_name)));
    push(kv([
      ["Date of birth", s(k.date_of_birth)],
      ["Declared ownership", k.exact_ownership_percent ? `${s(k.exact_ownership_percent)}%` : ""],
      ["Residential address", fmtAddr(k.residential_address as Rec)],
      ["PEP", k.is_pep ? `Yes${k.pep_detail ? ` — ${s(k.pep_detail)}` : ""}` : "No (self-declared)"],
      ["Consent given", k.consent_given ? "Yes" : "No"],
      ["Email", s(k.email)],
      ["Mobile", s(k.mobile)],
    ]));
    const mine = d.uboImages.filter((u) => u.ubo_ref && (u.ubo_ref === s(k.ubo_id) || u.ubo_ref === s(k.ubo_name)));
    for (const kind of [UBO_ID_KIND, UBO_PROOF_KIND]) {
      const doc = mine.find((u) => u.kind === kind);
      if (!doc) continue;
      push(body(kind === UBO_ID_KIND ? "Photo ID" : "Proof of address", { bold: true }));
      if (doc.img) push(image(doc.img, 300));
      else push(muted(`${doc.filename ?? "file"} — on file (preview unavailable).`));
    }
  }

  // 5. Identity & screening
  if (d.uboChecks.length) {
    push(h1("Identity & screening"));
    push(...kv(d.uboChecks.map((c) => [
      s(c.ubo_name),
      [`ID&V: ${s(c.idv_band) || "—"}${c.idv_score != null ? ` (${s(c.idv_score)})` : ""}`, c.pep_match ? "PEP MATCH" : "PEP: clear", c.sanctions_match ? "SANCTIONS MATCH" : "Sanctions: clear"].join(" · "),
    ] as [string, string])));
  }

  // 6. Business & compliance
  const biz = (d.form?.business as Rec) ?? {};
  const comp = (d.form?.compliance as Rec) ?? {};
  const sig = (d.form?.signatory as Rec) ?? {};
  const socials = (biz.socials as Rec) ?? {};
  push(h1("Business & compliance"));
  push(kv([
    ["Phone", s(biz.phone)], ["Email", s(biz.email)], ["Website", s(biz.website)],
    ["Principal office", s(biz.principal_office)],
    ["ICO number", s(comp.ico_number)], ["FCA FRN", s(comp.fca_frn)], ["VAT number", s(comp.vat_number)],
    ["Data protection officer", s(comp.dpo)], ["Privacy policy", s(comp.privacy_policy_url)], ["Trade body", s(comp.trade_body)],
    ["Social", [socials.facebook, socials.linkedin, socials.twitter, socials.instagram].map(s).filter(Boolean).join("  ·  ")],
    ["Authorised signatory", [sig.name, sig.title, sig.email].map(s).filter(Boolean).join(" · ")],
  ]));

  // 7. Payment profile
  const payRows = Object.entries(PAYMENT_LABELS).map(([key, label]) => ({ q: label, a: s(d.answers[key]?.value) }));
  const reasonRows = Object.keys(d.answers).filter((k) => k.startsWith("reason_")).map((k) => ({ q: `Reason for ${productLabel(k.replace(/^reason_/, ""))}`, a: s(d.answers[k]?.value) }));
  const payTable = qaTable([...payRows, ...reasonRows]);
  if (payTable.length) { push(h1("Payment profile")); push(...payTable); }

  // 8. Direct Debit
  const ddTable = qaTable(Object.entries(DD_LABELS).map(([key, label]) => ({ q: label, a: s(d.answers[key]?.value) })));
  if (ddTable.length) { push(h1("Direct Debit")); push(...ddTable); }

  // 9. Bank accounts (deduped on purpose + tail)
  const seen = new Set<string>();
  const banks = d.bankAccounts.filter((a) => { const key = `${s(a.purpose)}|${s(a.account_tail)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (banks.length) {
    push(h1("Bank accounts"));
    push(...kv(banks.map((a) => [
      titleCase(s(a.purpose)),
      [s(a.account_name), s(a.bank_name), a.account_tail ? `••••${s(a.account_tail)}` : "", a.cop_result ? `CoP: ${s(a.cop_result)}` : ""].filter(Boolean).join(" · "),
    ] as [string, string])));
  }

  // 10. Information security questionnaire
  const infosecTop = qaTable(Object.entries(INFOSEC_TOP_LABELS).map(([key, label]) => ({ q: label, a: s(d.answers[key]?.value) })));
  const over10 = s(d.answers.infosec_over_10?.value);
  const infosecDetail = over10 === "yes" ? INFOSEC_LARGE : over10 === "no" ? INFOSEC_SMALL : [];
  const infosecDetailTable = qaTable((infosecDetail as ReadonlyArray<readonly [string, string]>).map(([key, label]) => ({
    q: label, a: s(d.answers[key]?.value), note: s(d.answers[`${key}_explain`]?.value) || undefined,
  })));
  if (infosecTop.length || infosecDetailTable.length) {
    push(h1("Information security"));
    push(...infosecTop);
    if (infosecDetailTable.length) { push(h2(over10 === "yes" ? "Controls (>10 employees)" : "Controls (≤10 employees)")); push(...infosecDetailTable); }
  }

  // 11. Policies pack
  const polTable = qaTable(POLICY_QUESTIONS.map((q) => ({
    q: q.label, a: s(d.answers[q.key]?.value),
    note: s(d.answers[`${q.key}_detail`]?.value) || (s(d.answers[`${q.key}_later`]?.value) === "yes" ? "To be provided later" : undefined),
  })));
  if (polTable.length) { push(h1("Policies & certifications")); push(...polTable); }

  // 12. Privacy-policy assessment
  if (d.privacy && (d.privacy as Rec).result) {
    const pr = (d.privacy as Rec).result as Rec;
    push(h1("Privacy-policy assessment"));
    push(kv([
      ["Overall", titleCase(s(pr.overall))],
      ["Summary", s(pr.summary)],
      ["Gaps", Array.isArray(pr.gaps) ? (pr.gaps as string[]).join("; ") : ""],
      ["Concerns", Array.isArray(pr.concerns) ? (pr.concerns as string[]).join("; ") : ""],
    ]));
  }

  // 13. Infosec document uploads (metadata + extraction)
  const infosecDocs = d.uploads.filter((u) => u.content_type); // all uploaded supporting docs
  if (infosecDocs.length) {
    push(h1("Supporting documents"));
    for (const u of infosecDocs) {
      push(body(`${u.filename ?? "file"}`, { bold: true }));
      const ex = u.extracted as Rec | null;
      if (ex) {
        const line = [s(ex.document_type) && `Type: ${titleCase(s(ex.document_type))}`, s(ex.summary)].filter(Boolean).join(" — ");
        if (line) push(body(line, { color: GREY }));
        if (Array.isArray(ex.flags) && (ex.flags as string[]).length) push(body(`Flags: ${(ex.flags as string[]).join("; ")}`, { color: GREY, italics: true }));
      }
    }
  }

  // 14 + 15. Companies House documents — incorporation + accounts, pages embedded.
  await appendCompaniesHouseDocuments(d, push);

  const doc = new Document({
    creator: "Credit Canary",
    title: `Due Diligence Pack — ${companyName}`,
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: kids,
    }],
  });
  return Packer.toBuffer(doc);
}

/** Fetch the CH incorporation (IN01) + filed accounts PDFs and embed their pages
 *  as images. Best-effort — on the mock / without a live CH key this adds a note
 *  instead. */
async function appendCompaniesHouseDocuments(d: PackData, push: (...xs: (Paragraph | Table | (Paragraph | Table)[])[]) => void): Promise<void> {
  if (!d.companyNumber) return;
  const ch = getCompaniesHouse();
  const PAGE_W = 540;

  // Incorporation (IN01)
  push(h1("Companies House — Certificate of Incorporation (IN01)"));
  try {
    const inc = await ch.getIncorporationDocument(d.companyNumber);
    if (!inc) {
      push(muted("Will be embedded when the pack is generated with live Companies House access."));
    } else {
      if (inc.date || inc.description) push(muted(`${s(inc.description) || "Incorporation filing"}${inc.date ? ` · filed ${inc.date}` : ""}`));
      const pages = await pdfToImages(inc.pdf, { maxPages: 4, scale: 1.6 });
      for (const p of pages) push(image(p, PAGE_W));
      const total = await pdfPageCount(inc.pdf);
      if (total > pages.length) push(muted(`(${total - pages.length} further page(s) in the filed document.)`));
      if (!pages.length) push(muted("Incorporation document is on file at Companies House."));
    }
  } catch { push(muted("Incorporation document could not be retrieved.")); }

  // Filed accounts (all)
  push(h1("Companies House — Filed accounts"));
  try {
    const all = await ch.getAccountsDocuments(d.companyNumber);
    const accs = all.slice(0, 6); // bound pack size; older filings remain at CH
    if (!all.length) {
      push(muted("No filed accounts documents are available (or the pack was generated without live Companies House access)."));
    } else {
      if (all.length > accs.length) push(muted(`Showing the ${accs.length} most recent filings; ${all.length - accs.length} older filing(s) remain at Companies House.`));
      for (const a of accs) {
        push(h2([s(a.description) || "Accounts", a.madeUpTo ? `made up to ${a.madeUpTo}` : a.date ? `filed ${a.date}` : ""].filter(Boolean).join(" — ")));
        const pages = await pdfToImages(a.pdf, { maxPages: 5, scale: 1.5 });
        for (const p of pages) push(image(p, PAGE_W));
        const total = await pdfPageCount(a.pdf);
        if (total > pages.length) push(muted(`(${total - pages.length} further page(s) in this filing.)`));
      }
    }
  } catch { push(muted("Filed accounts could not be retrieved.")); }
}

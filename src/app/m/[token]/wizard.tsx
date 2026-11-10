// Multi-page customer questionnaire (Step 6 P0), behind ONBOARDING_FORM_V2.
// One shared link; the opener self-identifies (for per-field attribution), then
// moves through product-gated pages with Save-and-Continue / Continue, a
// progress bar, "don't know" toggles, and a gov.uk-style review before submit.
// Company-page answers live in onboarding_form_answers; sensitive sections (UBO
// KYC, bank accounts) use their typed tables via the slice-savers.

import Link from "next/link";
import type { ReactNode } from "react";
import { serviceClient } from "@/lib/db/client";
import { listStakeholders, ONBOARDING_ROLES } from "@/lib/onboarding/cases";
import { hubspotRepo } from "@/lib/hubspot/repo";
import { getAnswers, getProgress, attributionLine, type AnswerMap } from "@/lib/onboarding/formAnswers";
import { loadEnrichment, distinctIndividualUbos } from "@/lib/onboarding/enrich";
import { loadMerchantForm, type TokenCase } from "@/lib/onboarding/merchantForm";
import { loadUploads, loadUboDocStatus, loadUploadKinds } from "@/lib/onboarding/uploads";
import { requiresFcaFrn, requiresPayments, requiresDirectDebit, requiresTuSection, requiresPolicies } from "@/lib/onboarding/productGroups";
import { PendingButton } from "@/components/PendingButton";
import { AddressLookup } from "@/components/AddressLookup";
import {
  COMPANY_FIELDS, SOCIAL_FIELDS, DPO_FIELDS, collectDpos, dpoSummary, visibleFormPages,
  requiresTransactionProfile, paymentReasonProducts, productLabel, isCharityType,
  INFOSEC_SMALL, INFOSEC_LARGE, inputValidation, type AnswerFieldDef,
  POLICY_DOC_QUESTIONS, policyCertQuestions, visiblePolicyQuestions, type PolicyQuestion,
} from "./fields";
import type { FormEditorIdentity } from "@/lib/onboarding/formEditor";
import { parsePersonName, nameMatchKey } from "@/lib/onboarding/personName";
import { discoverPrivacyPolicyUrl } from "@/lib/onboarding/websiteScan";
import { TradingAddress, TradeBody, SignatoryPicker, DpoList, PepField, type DpoContact, type DpoRowData } from "./CompanyFields";
import { BankStatementQuestion } from "./PaymentFields";
import { setEditorAction, savePageAction, submitForApprovalAction, removeBankAccountAction, saveAndCloseAction } from "./actions";

// ─── Design tokens (B9 — locked) ─────────────────────────────────────────────
// Accent  #003566 navy (brand, every interactive/accent surface)
// States  emerald = done · amber = needs-follow-up ("don't know") · red = required/error
// Radius  controls rounded-md · containers rounded-lg · badges rounded · progress rounded-full
// Inputs  px-3 py-2.5 (≈44px tap target)
const fieldBase = "rounded-md border border-neutral-300 px-3 py-2.5 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const field = `w-full ${fieldBase}`;
const lbl = "block text-sm font-medium text-neutral-800 mb-1";
// Field label that reserves two lines at ≥sm (the 2-col breakpoint), so inputs
// in a grid row top-align even when one label wraps and its neighbour doesn't.
// Used by top-aligned cells; mobile (single column) keeps the natural height.
const lblTall = `${lbl} sm:min-h-[2.5rem]`;
const btnPrimary = "rounded-md bg-[#003566] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002a52]";
const btnSecondary = "rounded-md border border-neutral-300 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100";

// Small padlock trust cue, placed beside sensitive inputs (bank, identity).
function LockNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-neutral-500">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="7.5" width="10" height="6" rx="1.3" /><path d="M5 7.5V5.2a3 3 0 0 1 6 0v2.3" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

// One combined meta row under a field: the "don't know" toggle (left) and the
// attribution line (right) share a single baseline instead of stacking two
// faint sub-lines. Renders nothing when neither applies.
// Per-field meta is now just the optional "don't know" toggle — the per-field
// "updated by" attribution was removed in favour of one "Last updated" at the
// top of the form (item 6a). Attribution is still recorded on save.
// The per-field "Don't know - ask later" toggle was removed across the form
// (item 9) — every question is now answered outright. Kept as a no-op so the
// field helpers don't each need editing; the server still records is_unknown
// (always false now) harmlessly.
function FieldMeta(_props: { name: string; answers: AnswerMap; noUnknown?: boolean }) {
  return null;
}

// ─── Self-identify ───────────────────────────────────────────────────────────

export async function SelfIdentify({ token, caseId, v2 }: { token: string; caseId: string; v2?: string }) {
  const db = serviceClient();
  const stakeholders = await listStakeholders(db, caseId);
  const ids = [...new Set(stakeholders.map((s) => s.hubspot_contact_id))];
  const contacts = await Promise.all(ids.map((id) => hubspotRepo.getContact(id).catch(() => null)));
  const nameById = new Map(contacts.filter(Boolean).map((ct) => [ct!.id, ct!.full_name || ct!.email || ct!.id]));
  const people = ids.map((id) => ({
    id,
    name: nameById.get(id) ?? id,
    roles: stakeholders.filter((s) => s.hubspot_contact_id === id).map((s) => ONBOARDING_ROLES.find((r) => r.key === s.role)?.label ?? s.role).join(", "),
  }));

  return (
    <>
      <h1 className="text-2xl font-semibold text-[#003566]">Before you start</h1>
      <p className="mt-1 text-sm text-neutral-600">So we can track who provided each answer, please tell us who you are. Several people can fill this in - just pick yourself each time.</p>
      <form action={setEditorAction} className="mt-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="v2" value={v2 ?? ""} />
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="editor_contact_id" value={p.id} />
            <span className="font-medium text-neutral-800">{p.name}</span>
            {p.roles && <span className="text-xs text-neutral-400">{p.roles}</span>}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="editor_contact_id" value="other" defaultChecked={people.length === 0} />
          <span className="text-neutral-800">Someone else</span>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="editor_name" className={lbl}>Your name</label><input id="editor_name" name="editor_name" className={field} /></div>
          <div><label htmlFor="editor_email" className={lbl}>Your email (optional)</label><input id="editor_email" name="editor_email" type="email" className={field} /></div>
        </div>
        <PendingButton className={btnPrimary} pendingLabel="Starting…">Start →</PendingButton>
      </form>
    </>
  );
}

// ─── Wizard ──────────────────────────────────────────────────────────────────

export async function Wizard({ token, c, editor, page, v2, error }: {
  token: string; c: TokenCase; editor: FormEditorIdentity; page?: string; v2?: string; error?: string;
}) {
  const db = serviceClient();
  const pages = visibleFormPages(c.product_groups);
  const current = pages.find((p) => p.id === page)?.id ?? "company";
  const [answers, progress, enrichment, merchant, uploads, policyKinds] = await Promise.all([
    getAnswers(db, c.id),
    getProgress(db, c.id),
    loadEnrichment(db, c.id),
    loadMerchantForm(db, c.id),
    requiresTuSection(c.product_groups) ? loadUploads(db, c.id) : Promise.resolve([]),
    requiresPolicies(c.product_groups) ? loadUploadKinds(db, c.id) : Promise.resolve(new Set<string>()),
  ]);

  // Company/UBO-page prefills from the deal's contacts (signatory, DPO, UBO
  // email-by-name), the registered address, and privacy-URL discovery. Loaded
  // only on the pages that use them.
  let companyPrefill: CompanyPrefill | null = null;
  let uboEmailByName = new Map<string, string>();
  let uboDocStatus = new Map<string, { identity: boolean; proof: boolean }>();
  const payments = requiresPayments(c.product_groups);
  if (current === "company" || current === "ubos") {
    const stakeholders = await listStakeholders(db, c.id);
    const ids = [...new Set(stakeholders.map((s) => s.hubspot_contact_id))];
    const cts = (await Promise.all(ids.map((id) => hubspotRepo.getContact(id).catch(() => null)))).filter((x): x is NonNullable<typeof x> => !!x);
    uboEmailByName = new Map(cts.filter((ct) => ct.email).map((ct) => { const pn = parsePersonName(ct.full_name); return [nameMatchKey(pn.first, pn.last), ct.email!]; }));
    if (current === "ubos" && payments) uboDocStatus = await loadUboDocStatus(db, c.id);
    if (current === "company") {
      const byId = new Map(cts.map((ct) => [ct.id, ct]));
      const contacts = cts.map((ct) => ({ id: ct.id, name: ct.full_name || ct.email || ct.id, email: ct.email ?? "", title: ct.job_title ?? "" }));
      // DPO picker options — same contacts, but split into first/last for the row fields.
      const dpoContacts: DpoContact[] = cts.map((ct) => { const pn = parsePersonName(ct.full_name); return { id: ct.id, first: pn.first, last: pn.last, title: ct.job_title ?? "", email: ct.email ?? "", phone: ct.mobile ?? "" }; });
      const sigStake = stakeholders.find((s) => s.role === "authorised_signatory");
      const sigCt = sigStake ? byId.get(sigStake.hubspot_contact_id) : null;
      const signatory = sigCt ? { name: sigCt.full_name ?? "", email: sigCt.email ?? "", title: sigCt.job_title ?? "" } : null;
      const firstCt = cts[0];
      const dpoPrefill: DpoRowData | null = firstCt
        ? (() => { const pn = parsePersonName(firstCt.full_name); return { kind: "person" as const, company: "", first: pn.first, last: pn.last, title: firstCt.job_title ?? "", email: firstCt.email ?? "", phone: firstCt.mobile ?? "" }; })()
        : null;
      const ro = enrichment.snapshot?.registered_office ?? null;
      const registered = ro ? [ro.premises, ro.address_line_1, ro.address_line_2, ro.locality, ro.region, ro.postal_code, ro.country].map((x) => (x ?? "").trim()).filter(Boolean).join(", ") : "";
      let privacyUrl: string | null = null;
      if (!(answers["privacy_policy_url"]?.value ?? "").trim()) {
        const site = answers["website"]?.value ?? "";
        if (site.trim()) privacyUrl = await discoverPrivacyPolicyUrl(site);
      }
      companyPrefill = { contacts, dpoContacts, signatory, dpoPrefill, registered, privacyUrl };
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-[#003566]">Complete your onboarding</h1>
        <span className="text-xs text-neutral-500">Filling in as <strong>{editor.name}</strong>{editor.role ? ` (${editor.role})` : ""}</span>
      </div>

      {/* Progress — compact bar on phones, full step chips on larger screens */}
      {(() => {
        const idx = Math.max(0, pages.findIndex((p) => p.id === current));
        return (
          <div className="mt-4 sm:hidden">
            <div className="flex items-baseline justify-between text-xs text-neutral-500">
              <span>Step {idx + 1} of {pages.length}</span>
              <span className="font-medium text-[#003566]">{pages[idx]?.label}</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-neutral-200">
              <div className="h-1 rounded-full bg-[#003566] transition-[width]" style={{ width: `${((idx + 1) / pages.length) * 100}%` }} />
            </div>
          </div>
        );
      })()}
      <ol className="mt-4 hidden flex-wrap gap-1.5 text-xs sm:flex">
        {pages.map((p, i) => {
          const done = progress.has(p.id);
          const active = p.id === current;
          return (
            <li key={p.id}>
              <Link
                href={`/m/${encodeURIComponent(token)}?page=${p.id}${v2 ? `&v2=${v2}` : ""}`}
                className={`flex items-center gap-1 rounded px-2 py-1 ${active ? "bg-[#003566] text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}
              >
                <span className="font-medium">{done && !active ? "✓" : i + 1}</span> {p.label}
              </Link>
            </li>
          );
        })}
      </ol>

      {error === "required" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Please complete the required fields, or tick &ldquo;don&apos;t know&rdquo; where offered, before continuing.</p>}
      {error === "email" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Please use a company email address, not a personal one (e.g. not gmail/outlook/yahoo).</p>}
      {error === "attest" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Please confirm the beneficial-owner list is complete before continuing.</p>}
      {error === "account" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Please add at least one bank account before continuing.</p>}
      {error === "ubo_docs" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">For payments onboarding, please upload a photo ID and a proof of address for each beneficial owner before continuing.</p>}
      {error === "policies" && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Please answer each question. Where you answered Yes, attach a document, paste the text, or tick &ldquo;I&apos;ll provide this later&rdquo; before continuing.</p>}
      {error === "save" && <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">Something went wrong saving - please try again.</p>}

      {/* One "Last updated" for the whole form (replaces the per-field markers). */}
      {(() => {
        let latest: AnswerMap[string] | null = null;
        for (const k in answers) { const a = answers[k]; if (a?.updated_at && (!latest || a.updated_at > latest.updated_at)) latest = a; }
        const line = attributionLine(latest);
        return line ? <p className="mt-3 text-[11px] text-neutral-400">{line.replace(/^Updated/, "Last updated")}</p> : null;
      })()}

      <div className="mt-5">
        {current === "company" && <CompanyPage token={token} c={c} answers={answers} prefill={companyPrefill!} v2={v2} />}
        {current === "ubos" && <UbosPage token={token} c={c} enrichment={enrichment} merchant={merchant} answers={answers} emailByName={uboEmailByName} payments={payments} uboDocs={uboDocStatus} v2={v2} />}
        {current === "accounts" && <AccountsPage token={token} c={c} merchant={merchant} v2={v2} />}
        {current === "payments" && <PaymentsPage token={token} c={c} answers={answers} companyName={enrichment.snapshot?.company_name ?? ""} charity={isCharityType(enrichment.snapshot?.company_type)} v2={v2} />}
        {current === "infosec" && <InfosecPage token={token} answers={answers} uploadCount={uploads.length} v2={v2} />}
        {current === "policies" && <PoliciesPage token={token} answers={answers} policyKinds={policyKinds} groups={c.product_groups} v2={v2} />}
        {current === "review" && <ReviewPage token={token} c={c} answers={answers} merchant={merchant} progress={progress} v2={v2} />}
      </div>
    </>
  );
}

// ─── Shared page chrome ──────────────────────────────────────────────────────

function PageForm({ token, page, v2, title, intro, children }: {
  token: string; page: string; v2?: string; title: string; intro?: string; children: ReactNode;
}) {
  return (
    <form action={savePageAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="page" value={page} />
      <input type="hidden" name="v2" value={v2 ?? ""} />
      <div>
        <h2 className="text-lg font-semibold text-[#003566]">{title}</h2>
        {intro && <p className="mt-0.5 text-sm text-neutral-500">{intro}</p>}
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="mode" value="draft" formNoValidate className={btnSecondary}>Save &amp; finish later</button>
        {/* Save & continue anyway — advances without validation (item 6). */}
        <button type="submit" name="mode" value="skip" formNoValidate className={btnSecondary}>Save &amp; continue anyway</button>
        {/* formNoValidate: never let a prefilled-but-invalid off-screen field
            (e.g. a KYC phone/email) silently block submit — the server validates
            and returns a clear message instead (item 7). */}
        <button type="submit" name="mode" value="continue" formNoValidate className={btnPrimary}>Continue →</button>
      </div>
    </form>
  );
}

function AnswerField({ def, answers, fcaRequired, defaultValue }: { def: AnswerFieldDef; answers: AnswerMap; fcaRequired: boolean; defaultValue?: string }) {
  const a = answers[def.key];
  const required = def.required || (def.requiredIfFca && fcaRequired);
  return (
    <div>
      <label htmlFor={def.key} className={lblTall}>{def.label}{required && <span className="text-red-600"> *</span>}</label>
      {/* No HTML `required` on fields that offer "don't know" — otherwise the
          browser blocks submit even when the box is ticked (item 4). Server-side
          validation still enforces them unless don't-know is set. */}
      <input id={def.key} name={def.key} type={def.type ?? "text"} defaultValue={a?.value ?? defaultValue ?? ""} className={field} required={required && !def.unknownOk} {...inputValidation(def.type)} />
      {def.help && <a href={def.help.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-[#003566] underline">{def.help.label} ↗</a>}
      <FieldMeta name={def.key} answers={answers} noUnknown={!def.unknownOk} />
    </div>
  );
}

// ─── Pages ───────────────────────────────────────────────────────────────────

interface CompanyPrefill {
  contacts: { id: string; name: string; email: string; title: string }[];
  dpoContacts: DpoContact[];
  signatory: { name: string; email: string; title: string } | null;
  dpoPrefill: DpoRowData | null;
  registered: string;
  privacyUrl: string | null;
}

function CompanyPage({ token, c, answers, prefill, v2 }: { token: string; c: TokenCase; answers: AnswerMap; prefill: CompanyPrefill; v2?: string }) {
  const fcaRequired = requiresFcaFrn(c.product_groups);
  const tuCredit = c.product_groups.includes("tu_credit");
  const fields = COMPANY_FIELDS.filter((f) => !f.onlyIfTuCredit || tuCredit);
  // Existing DPOs from the answer store (so a return visit keeps what was typed).
  const existingDpos: DpoRowData[] = [];
  for (let i = 0; i < 20; i++) {
    const g = (k: string) => (answers[`dpo_${i}_${k}`]?.value ?? "").trim();
    const kind: "person" | "company" = g("kind") === "company" ? "company" : "person";
    const has = kind === "company" ? (g("company") || g("email")) : (g("first") || g("last") || g("email"));
    if (has) existingDpos.push({ kind, company: g("company"), first: g("first"), last: g("last"), title: g("title"), email: g("email"), phone: g("phone") });
  }

  return (
    <PageForm token={token} page="company" v2={v2} title="Company details" intro="Confirm your business, compliance and authorised-signatory details.">
      <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <AnswerField def={fields[0]!} answers={answers} fcaRequired={fcaRequired} />
        {/* Trading address: same-as-registered toggle + Postcoder lookup (item 5). */}
        <TradingAddress registered={prefill.registered} defaultAddress={answers["trading_address"]?.value ?? ""} />
        {fields.slice(1).map((f) => (
          <AnswerField key={f.key} def={f} answers={answers} fcaRequired={fcaRequired}
            defaultValue={f.key === "privacy_policy_url" ? (prefill.privacyUrl ?? undefined) : undefined} />
        ))}
      </fieldset>

      {/* Trade body (6d): the "which?" field shows only when Yes is selected. */}
      <TradeBody requiredDefault={answers["trade_body_required"]?.value ?? ""} bodyDefault={answers["trade_body"]?.value ?? ""} />

      {/* Authorised signatory (item 9): prefill from the assigned signatory, else
          pick an existing contact or enter a new one. */}
      <SignatoryPicker
        contacts={prefill.contacts}
        prefill={prefill.signatory}
        defaults={{ name: answers["signatory_name"]?.value ?? "", title: answers["signatory_title"]?.value ?? "", email: answers["signatory_email"]?.value ?? "" }}
      />

      {/* Data protection officers (item 6f): one by default, prefilled; each row
          can pick an existing contact or add a new one (added to HubSpot). */}
      <DpoList initial={existingDpos} prefill={prefill.dpoPrefill} contacts={prefill.dpoContacts} />

      {/* Social media (optional) */}
      <fieldset className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Social media <span className="font-normal text-neutral-400">(optional)</span></legend>
        {SOCIAL_FIELDS.map((s) => (
          <div key={s.key}>
            <label htmlFor={s.key} className={lbl}>{s.label}</label>
            <input id={s.key} name={s.key} type="url" inputMode="url" placeholder="https://" defaultValue={answers[s.key]?.value ?? ""} className={field} />
          </div>
        ))}
      </fieldset>
    </PageForm>
  );
}

function UbosPage({ token, c, enrichment, merchant, answers, emailByName, payments, uboDocs, v2 }: {
  token: string; c: TokenCase; enrichment: Awaited<ReturnType<typeof loadEnrichment>>; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; answers: AnswerMap; emailByName: Map<string, string>; payments: boolean; uboDocs: Map<string, { identity: boolean; proof: boolean }>; v2?: string;
}) {
  const individualUbos = distinctIndividualUbos(enrichment.ubos);
  const kycByUbo = new Map(merchant.kyc.map((k) => [k.ubo_id ?? k.ubo_name, k]));
  // We hold the month + year from Companies House; resolve them (prefer any
  // saved DOB), so the form only asks the owner for the day (item 6g).
  const monthName = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-GB", { month: "long" });
  const dobParts = (dbDate: string | null | undefined, month: number | null, year: number | null) => {
    if (dbDate) { const d = new Date(dbDate); if (isFinite(d.getTime())) { const day = d.getUTCDate(); return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), day: day && day !== 1 ? String(day) : "" }; } }
    return { month: month ?? null, year: year ?? null, day: "" };
  };
  return (
    <PageForm token={token} page="ubos" v2={v2} title="Beneficial owners" intro="Confirm the details for each person with significant control (25%+ ownership or control).">
      <input type="hidden" name="ubo_count" value={individualUbos.length} />
      <LockNote>Identity details are encrypted and used only for anti-money-laundering checks.</LockNote>
      {individualUbos.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">No beneficial owners are on file from Companies House. If anyone owns or controls 25%+ of the business, please confirm below and we&apos;ll follow up separately.</p>
      ) : (
        <div className="space-y-4">
          {individualUbos.map((u, i) => {
            const k = kycByUbo.get(u.id) ?? kycByUbo.get(u.name ?? "");
            const addr = k?.residential_address ?? {};
            return (
              <div key={u.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <input type="hidden" name={`ubo_id_${i}`} value={u.id} />
                <input type="hidden" name={`ubo_name_${i}`} value={u.name ?? ""} />
                <div className="mb-2 font-medium text-neutral-800">{u.name}</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={lbl}>Date of birth</label>
                    {(() => {
                      const p = dobParts(k?.date_of_birth, u.dob_month, u.dob_year);
                      if (p.month && p.year) return (
                        <>
                          <input type="hidden" name={`ubo_dob_month_${i}`} value={p.month} />
                          <input type="hidden" name={`ubo_dob_year_${i}`} value={p.year} />
                          <div className="flex flex-nowrap items-center gap-2">
                            <input name={`ubo_dob_day_${i}`} inputMode="numeric" pattern="(0?[1-9]|[12]\d|3[01])" placeholder="DD" title="Enter the day of the month (1-31)" defaultValue={p.day} className={`${fieldBase} w-16 shrink-0 text-center`} />
                            <span className="whitespace-nowrap text-sm text-neutral-600">{monthName(p.month)} {p.year}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-neutral-400">We have the month and year from Companies House - just add the day.</p>
                        </>
                      );
                      return <input name={`ubo_dob_${i}`} inputMode="numeric" pattern="(0[1-9]|1[0-2])/\d{4}" placeholder="MM/YYYY" title="Enter the month and year, e.g. 03/1985" defaultValue="" className={field} />;
                    })()}
                  </div>
                  <div><label className={lbl}>Exact ownership %</label><input name={`ubo_pct_${i}`} defaultValue={k?.exact_ownership_percent ?? ""} placeholder="e.g. 60%" className={field} /></div>
                  <div><label className={lbl}>Email</label><input type="email" name={`ubo_email_${i}`} defaultValue={k?.email ?? (u.name ? emailByName.get(nameMatchKey(parsePersonName(u.name).first, parsePersonName(u.name).last)) ?? "" : "")} className={field} /></div>
                  <div><label className={lbl}>Mobile</label><input type="tel" name={`ubo_mobile_${i}`} defaultValue={k?.mobile ?? ""} className={field} {...inputValidation("tel")} /></div>
                </div>
                <div className="mt-3">
                  <span className={lbl}>Residential address</span>
                  <AddressLookup
                    line1Name={`ubo_addr1_${i}`} line2Name={`ubo_addr2_${i}`}
                    cityName={`ubo_city_${i}`} postcodeName={`ubo_postcode_${i}`} countryName={`ubo_country_${i}`}
                    defaults={{ line1: addr.line1, line2: addr.line2, city: addr.city, postcode: addr.postcode, country: addr.country }}
                  />
                </div>
                <PepField idx={i} defaultPep={!!k?.is_pep} defaultDetail={k?.pep_detail ?? ""} />
                <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
                  <input type="checkbox" name={`ubo_consent_${i}`} defaultChecked={!!k?.consent_given} className="mt-0.5" />
                  <span>This person consents to Credit Canary verifying their identity for anti-money-laundering checks.</span>
                </label>
                {payments && (() => {
                  const st = uboDocs.get(u.id) ?? { identity: false, proof: false };
                  return (
                    <div className="mt-3 rounded border border-neutral-200 p-3">
                      <LockNote>Payments onboarding requires identity verification for each owner.</LockNote>
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className={lblTall}>Photo ID - passport or driving licence{!st.identity && <span className="text-red-600"> *</span>}</label>
                          <input type="file" name={`ubo_id_file_${i}`} accept=".pdf,.png,.jpg,.jpeg" className={fileInput} />
                          {st.identity && <p className="mt-1 text-xs text-emerald-700">✓ On file - upload again only to replace</p>}
                        </div>
                        <div>
                          <label className={lblTall}>Proof of address - utility bill / bank statement{!st.proof && <span className="text-red-600"> *</span>}</label>
                          <input type="file" name={`ubo_proof_file_${i}`} accept=".pdf,.png,.jpg,.jpeg" className={fileInput} />
                          {st.proof && <p className="mt-1 text-xs text-emerald-700">✓ On file - upload again only to replace</p>}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      <label className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-800">
        <input type="checkbox" name="ubo_list_complete" defaultChecked={answers["ubo_list_complete"]?.value === "yes"} className="mt-0.5" />
        <span>I confirm this is the complete list of beneficial owners - everyone who owns or controls 25% or more of the business. <span className="text-red-600">*</span></span>
      </label>
    </PageForm>
  );
}

function CopBadge({ result, matched }: { result: string; matched: string | null }) {
  const r = result.toLowerCase();
  const cls = r.includes("full") ? "bg-emerald-100 text-emerald-700"
    : r.includes("close") ? "bg-amber-100 text-amber-800"
    : r.includes("no") ? "bg-red-100 text-red-700"
    : "bg-neutral-100 text-neutral-500";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`} title={matched ?? undefined}>CoP: {result}</span>;
}

function AccountsPage({ token, c, merchant, v2 }: { token: string; c: TokenCase; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; v2?: string }) {
  const addCount = 1;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#003566]">Bank accounts</h2>
        <p className="mt-0.5 text-sm text-neutral-500">These are the account(s) you&apos;ll receive your funds into. Add one below - you can add more after saving.</p>
        <div className="mt-1.5"><LockNote>Stored encrypted and checked with Confirmation of Payee. We never display your full account number back.</LockNote></div>
      </div>

      {merchant.bankAccounts.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-700">On file</h3>
          <ul className="space-y-2">
            {merchant.bankAccounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 p-2 text-sm">
                <span className="text-neutral-800">{a.account_name || "-"}</span>
                <span className="font-mono text-neutral-500">••••{a.account_tail ?? "----"}</span>
                {a.cop_result && <CopBadge result={a.cop_result} matched={a.cop_matched_name} />}
                <form action={removeBankAccountAction} className="ml-auto">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="v2" value={v2 ?? ""} />
                  <input type="hidden" name="account_id" value={a.id} />
                  <button type="submit" className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={savePageAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="page" value="accounts" />
        <input type="hidden" name="v2" value={v2 ?? ""} />
        <input type="hidden" name="add_count" value={addCount} />
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Add an account to receive funds</legend>
          <div className="mt-2 space-y-4">
            {Array.from({ length: addCount }).map((_, i) => (
              <div key={i} className="grid grid-cols-1 gap-3 border-t border-neutral-100 pt-3 first:border-0 first:pt-0 sm:grid-cols-2">
                <div><label htmlFor={`add_${i}_name`} className={lbl}>Account name</label><input id={`add_${i}_name`} name={`add_${i}_name`} className={field} /></div>
                <div><label htmlFor={`add_${i}_bank`} className={lbl}>Bank</label><input id={`add_${i}_bank`} name={`add_${i}_bank`} className={field} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor={`add_${i}_sort`} className={lbl}>Sort code</label><input id={`add_${i}_sort`} name={`add_${i}_sort`} inputMode="numeric" placeholder="00-00-00" className={field} /></div>
                  <div><label htmlFor={`add_${i}_number`} className={lbl}>Account number</label><input id={`add_${i}_number`} name={`add_${i}_number`} inputMode="numeric" placeholder="8 digits" className={field} /></div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-400">Save this account to add another, or continue if this is the only one.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" name="mode" value="draft" formNoValidate className={btnSecondary}>Save &amp; finish later</button>
          <button type="submit" name="mode" value="skip" formNoValidate className={btnSecondary}>Save &amp; continue anyway</button>
          <button type="submit" name="mode" value="continue" formNoValidate className={btnPrimary}>Continue →</button>
        </div>
      </form>
    </div>
  );
}

// "Don't know - ask later": lets the filler defer any payment/infosec question to
// the economic buyer. On by default for these helpers; opt out with noUnknown.
// The toggle + attribution render together on one row via FieldMeta.
function TextA({ name, label, answers, type = "text", placeholder, required, full, noUnknown }: {
  name: string; label: string; answers: AnswerMap; type?: string; placeholder?: string; required?: boolean; full?: boolean; noUnknown?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label htmlFor={name} className={lblTall}>{label}{required && <span className="text-red-600"> *</span>}</label>
      <input id={name} name={name} type={type} placeholder={placeholder} defaultValue={answers[name]?.value ?? ""} className={field} />
      <FieldMeta name={name} answers={answers} noUnknown={noUnknown} />
    </div>
  );
}
function RadioA({ name, label, answers, options, required, dflt, full, noUnknown }: {
  name: string; label: string; answers: AnswerMap; options: { value: string; label: string }[]; required?: boolean; dflt?: string; full?: boolean; noUnknown?: boolean;
}) {
  const cur = answers[name]?.value ?? "";
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <span className={lbl}>{label}{required && <span className="text-red-600"> *</span>}</span>
      <div className="flex flex-wrap gap-4 text-sm">
        {options.map((o) => <label key={o.value} className="flex items-center gap-1.5"><input type="radio" name={name} value={o.value} defaultChecked={cur ? cur === o.value : o.value === dflt} /> {o.label}</label>)}
      </div>
      <FieldMeta name={name} answers={answers} noUnknown={noUnknown} />
    </div>
  );
}
function SelectA({ name, label, answers, options, required, noUnknown }: {
  name: string; label: string; answers: AnswerMap; options: { value: string; label: string }[]; required?: boolean; noUnknown?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className={lblTall}>{label}{required && <span className="text-red-600"> *</span>}</label>
      <select id={name} name={name} defaultValue={answers[name]?.value ?? ""} className={field}>
        <option value="">-</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldMeta name={name} answers={answers} noUnknown={noUnknown} />
    </div>
  );
}

const YN = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const SIGNUP_OPTIONS = [
  { value: "paper", label: "Paper" }, { value: "telephone", label: "Telephone" }, { value: "edd", label: "eDD" },
  { value: "api", label: "API" }, { value: "xero", label: "Xero" },
];

function PaymentsPage({ token, c, answers, companyName, charity, v2 }: {
  token: string; c: TokenCase; answers: AnswerMap; companyName: string; charity: boolean; v2?: string;
}) {
  const showProfile = requiresTransactionProfile(c.product_groups);
  const showDd = requiresDirectDebit(c.product_groups);
  const reasonProducts = paymentReasonProducts(c.product_groups);
  const signup = new Set((answers["dd_signup"]?.value ?? "").split(",").filter(Boolean));
  const stmtExample = answers["dd_statement_display"]?.value || companyName || "YOURCOMPANY";
  return (
    <PageForm token={token} page="payments" v2={v2} title="Payment details" intro="Tell us how you take and collect payments.">
      {showProfile && (
        <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Transaction profile</legend>
          <BankStatementQuestion companyName={companyName} answerValue={answers["pay_bank_statement"]?.value ?? ""} reasonDefault={answers["pay_bank_statement_reason"]?.value ?? ""} />
          <TextA name="pay_take_payments_for" label="What will you take payments for?" answers={answers} required full />
          <TextA name="pay_expected_volume" label="Expected monthly transaction volume (number of transactions)" answers={answers} required />
          <TextA name="pay_avg_value" label="Average transaction value (£)" answers={answers} required placeholder="£" />
          <TextA name="pay_max_value" label="Maximum transaction value (£)" answers={answers} required placeholder="£" />
          <RadioA name="pay_b2b_b2c" label="Do you provide your service B2B or B2C?" answers={answers} options={[{ value: "b2c", label: "B2C" }, { value: "b2b", label: "B2B" }, { value: "both", label: "Both" }]} required />
          <TextA name="pay_b2b_pct" label="If both - B2B %" answers={answers} />
          <TextA name="pay_b2c_pct" label="If both - B2C %" answers={answers} />
          <TextA name="pay_collect_method" label="How do you currently collect payments, and who is your provider?" answers={answers} required full />
        </fieldset>
      )}

      {reasonProducts.length > 0 && (
        <fieldset className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Why each payment type?</legend>
          {reasonProducts.map((p) => <TextA key={p} name={`reason_${p}`} label={`Reason for ${productLabel(p)}`} answers={answers} required full />)}
        </fieldset>
      )}

      {showDd && (
        <fieldset className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Direct Debit</legend>
          <RadioA name="dd_has_sun" label="Do you have an active SUN (Service User Number)?" answers={answers} options={YN} required full />
          <TextA name="dd_sun_number" label="If yes - SUN number" answers={answers} />
          <TextA name="dd_sun_provider" label="If yes - provider" answers={answers} />
          <RadioA name="dd_branded_sun_ok" label="If no - happy for Credit Canary to provide a branded SUN?" answers={answers} options={[{ value: "yes", label: "Yes" }]} full />
          <div className="sm:col-span-2">
            <TextA name="dd_statement_display" label="What should show on your customers' bank statements?" answers={answers} placeholder={companyName || "Your company"} />
            <p className="mt-0.5 text-[11px] text-neutral-400">Live example: “<span className="font-mono">{stmtExample.slice(0, 18)}</span>” will appear on their statement.</p>
          </div>
          <RadioA name="dd_transfer" label="Transferring all existing Direct Debits, or a partial transfer?" answers={answers} options={[{ value: "all", label: "All" }, { value: "partial", label: "Partial" }]} required full />
          <TextA name="dd_max_collection_limit" label="Max collection limit per customer, per month (£)" answers={answers} required placeholder="£" />
          <SelectA name="dd_frequency" label="Frequency of collections" answers={answers} required options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "annual", label: "Annual" }, { value: "other", label: "Other" }]} />
          <TextA name="dd_frequency_other" label="If other - please specify" answers={answers} />
          <TextA name="dd_frequency_split" label="If more than one frequency - the split (e.g. 10% weekly, 70% monthly)" answers={answers} full />
          <RadioA name="dd_before_after" label="Do you collect before or after the service is provided?" answers={answers} options={[{ value: "before", label: "Before" }, { value: "after", label: "After" }]} required full />
          <div className="sm:col-span-2">
            <span className={lbl}>How will you sign customers up to Direct Debit? <span className="text-red-600">*</span></span>
            <div className="flex flex-wrap gap-4 text-sm">
              {SIGNUP_OPTIONS.map((o) => <label key={o.value} className="flex items-center gap-1.5"><input type="checkbox" name="dd_signup" value={o.value} defaultChecked={signup.size ? signup.has(o.value) : o.value === "api"} /> {o.label}</label>)}
            </div>
          </div>
          <div className="sm:col-span-2">
            <RadioA name="dd_schedule" label="Which schedule applies?" answers={answers} options={[{ value: "fixed", label: "Fixed" }, { value: "rolling", label: "Rolling" }, { value: "adhoc", label: "Ad-hoc" }]} required />
            <p className="mt-0.5 text-[11px] text-neutral-400">Fixed: a regular amount each month over a fixed period. Rolling: a regular amount each month with no end date. Ad-hoc: variable amounts on the same or different days each month.</p>
          </div>
          <TextA name="dd_collection_dates" label="What date(s) would you like to collect from your customers?" answers={answers} required full />
          <div className="sm:col-span-2">
            <RadioA name="dd_advance_notice" label="How should we send Advance Notices?" answers={answers} options={[{ value: "email", label: "Email" }, { value: "letter", label: "Letter" }]} dflt="email" required />
            <p className="mt-0.5 text-[11px] text-neutral-400">Additional charges apply for letters.</p>
          </div>
          <RadioA name="dd_auto_represent" label="Auto-represent failed collections?" answers={answers} options={YN} dflt="yes" required full />
          {charity && <RadioA name="dd_gift_aid" label="As a registered charity, do you require Gift Aid?" answers={answers} options={YN} required full />}
        </fieldset>
      )}
    </PageForm>
  );
}

const fileInput = "mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-[#003566] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#002a52]";

/** A yes/no question with an optional conditional "explain" field below. */
function YnRow({ name, label, answers, dflt, explainLabel, options = YN }: {
  name: string; label: string; answers: AnswerMap; dflt?: string; explainLabel?: string; options?: { value: string; label: string }[];
}) {
  return (
    <div className="border-t border-neutral-100 pt-3 first:border-0 first:pt-0">
      <RadioA name={name} label={label} answers={answers} options={options} dflt={dflt} required />
      {explainLabel && <div className="mt-1"><TextA name={`${name}_explain`} label={explainLabel} answers={answers} noUnknown /></div>}
    </div>
  );
}

function InfosecPage({ token, answers, uploadCount, v2 }: { token: string; answers: AnswerMap; uploadCount: number; v2?: string }) {
  const over = answers["infosec_over_10"]?.value ?? "";
  const cert = (key: string, label: string) => (
    <div className="border-t border-neutral-100 pt-3 first:border-0 first:pt-0">
      <RadioA name={`infosec_${key}`} label={label} answers={answers} options={YN} required />
      <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextA name={`infosec_${key}_expiry`} label="If yes - expiry date" answers={answers} type="date" />
        <TextA name={`infosec_${key}_assessor`} label="If yes - assessor (e.g. BSI)" answers={answers} />
      </div>
    </div>
  );
  return (
    <PageForm token={token} page="infosec" v2={v2} title="Information security" intro="A few questions about how you keep data secure (required for TransUnion products).">
      <fieldset className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">About your business</legend>
        <YnRow name="infosec_cmc_pi" label="Is your business a Claims Management Company or Private Investigator firm?" answers={answers} />
        <YnRow name="infosec_search_type_ok" label="Is the intended search type in keeping with the nature of your business?" answers={answers} dflt="yes" />
        <YnRow name="infosec_shared_email" label="Is the company email a shared account used by multiple individuals?" answers={answers} />
        <YnRow name="infosec_ico_notice" label="Have you ever received an Enforcement or Decision Notice from the ICO?" answers={answers} />
        <YnRow name="infosec_data_transfer" label="Do you intend to transfer any data outside the UK and EEA?" answers={answers} />
        <YnRow name="infosec_industry_body" label="Do you require membership of a recognised industry body / trade association?" answers={answers} />
        <YnRow name="infosec_membership_valid" label="If a member - is the membership valid and current?" answers={answers} />
      </fieldset>

      <fieldset className="mt-4 space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Certifications</legend>
        {cert("iso27001", "ISO 27001?")}
        {cert("pci", "PCI DSS?")}
        {cert("soc2", "SOC2?")}
        <YnRow name="infosec_iso27001_intending" label="Intending to become ISO 27001 accredited (audit scheduled in next 3 months)?" answers={answers} />
        <YnRow name="infosec_align_other" label="Do you align to other required security arrangements?" answers={answers} explainLabel="If no, please explain why" />
        <TextA name="infosec_align_detail" label="If yes - please provide detail" answers={answers} full />
      </fieldset>

      <fieldset className="mt-4 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Your security controls</legend>
        <RadioA name="infosec_over_10" label="Does your business have more than 10 employees?" answers={answers} options={YN} required />
        {!over ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Answer the question above and click <strong>Save &amp; finish later</strong> - we&apos;ll then show the security questions for your business size.</p>
        ) : over === "no" ? (
          <div className="space-y-1">
            {INFOSEC_SMALL.map(([k, l]) => (
              <YnRow key={k} name={k} label={l} answers={answers}
                dflt={k === "s_own_login" ? "yes" : undefined}
                options={k === "s_own_login" ? [{ value: "yes", label: "Yes" }] : YN}
                explainLabel={k === "s_personal_devices" ? "If yes, please explain why" : k === "s_own_login" ? undefined : "If no, please explain why"} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {INFOSEC_LARGE.map(([k, l]) => (
              <div key={k}>
                <YnRow name={k} label={l} answers={answers} explainLabel={k === "l_personal_devices" ? "If yes, please explain why" : "If no, please explain why"} />
                {k === "l_infosec_policy" && <div><label className="text-xs text-neutral-500">If yes - upload the policy</label><input name="infosec_policy_file" type="file" accept=".pdf,.doc,.docx,.txt" className={fileInput} /></div>}
                {k === "l_pentest" && <div><label className="text-xs text-neutral-500">If yes - upload the report</label><input name="pentest_file" type="file" accept=".pdf,.doc,.docx,.txt" className={fileInput} /></div>}
                {k === "l_cyber_insurance" && <div><label className="text-xs text-neutral-500">If yes - upload the certificate</label><input name="cyber_insurance_file" type="file" accept=".pdf,.doc,.docx,.txt" className={fileInput} /></div>}
              </div>
            ))}
            <div className="border-t border-neutral-100 pt-3">
              <TextA name="l_encryption_detail" label="Confirm data is encrypted at rest and in transit - detail the standards / technologies used" answers={answers} required full />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Other documents <span className="font-normal text-neutral-400">(optional)</span></legend>
        {uploadCount > 0 && <p className="mb-1 text-sm text-neutral-500">{uploadCount} already uploaded.</p>}
        <input type="file" name="infosec_files" multiple accept=".pdf,.doc,.docx,.txt,.md" className={fileInput} />
      </fieldset>
    </PageForm>
  );
}

// ─── Policies page (Faster Payments / Settlement Accounts) ───────────────────

/** Multi-line answer (paste a policy, or free-text detail). Optional, so no
 *  "don't know" toggle — a merchant can attach a document instead. */
function TextareaA({ name, label, answers, placeholder, rows = 3 }: {
  name: string; label: string; answers: AnswerMap; placeholder?: string; rows?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className={lbl}>{label}</label>
      <textarea id={name} name={name} rows={rows} placeholder={placeholder} defaultValue={answers[name]?.value ?? ""} className={field} />
    </div>
  );
}

/** One policy question: Yes/No, then (if yes) a document upload + paste box, or
 *  a free-text detail box for the "other certifications" question, plus an "I'll
 *  provide this later" escape hatch. Everything is shown below the Yes/No
 *  (server-rendered, no client reveal), labelled "If yes - …". */
function PolicyRow({ q, answers, onFile }: { q: PolicyQuestion; answers: AnswerMap; onFile: boolean }) {
  const later = (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
      <input type="checkbox" name={`${q.key}_later`} defaultChecked={(answers[`${q.key}_later`]?.value ?? "") === "yes"} /> I&apos;ll provide this later
    </label>
  );
  return (
    <div className="border-t border-neutral-100 pt-3 first:border-0 first:pt-0">
      <RadioA name={q.key} label={q.label} answers={answers} options={YN} required noUnknown />
      {q.detailOnly ? (
        <div className="mt-2">
          <TextareaA name={`${q.key}_detail`} label="If yes - please provide detail" answers={answers} />
          {later}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {onFile && <p className="text-xs text-emerald-700">✓ Document on file - upload again only to replace.</p>}
          <div>
            <label htmlFor={`${q.key}_file`} className="block text-xs text-neutral-500">If yes - upload the document (PDF / Word / text / Markdown)</label>
            <input id={`${q.key}_file`} name={`${q.key}_file`} type="file" accept=".pdf,.doc,.docx,.txt,.md" className={fileInput} />
          </div>
          <TextareaA name={`${q.key}_text`} label="…or paste the text here instead" answers={answers} />
          {later}
        </div>
      )}
    </div>
  );
}

function PoliciesPage({ token, answers, policyKinds, groups, v2 }: {
  token: string; answers: AnswerMap; policyKinds: Set<string>; groups: string[]; v2?: string;
}) {
  const certQs = policyCertQuestions(groups);
  return (
    <PageForm token={token} page="policies" v2={v2} title="Policies &amp; certifications"
      intro="Because you're onboarding for Faster Payments or Settlement Accounts, we need a view of your governance and financial-crime controls. Answer each question; where you answer Yes, attach the document, paste the text, or tick &ldquo;I'll provide this later&rdquo;.">
      <fieldset className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Policies, procedures &amp; reports</legend>
        {POLICY_DOC_QUESTIONS.map((q) => <PolicyRow key={q.key} q={q} answers={answers} onFile={policyKinds.has(q.key)} />)}
      </fieldset>
      <fieldset className="mt-4 space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-[#003566]">Certifications</legend>
        {certQs.map((q) => <PolicyRow key={q.key} q={q} answers={answers} onFile={policyKinds.has(q.key)} />)}
      </fieldset>
    </PageForm>
  );
}

function ReviewPage({ token, c, answers, merchant, progress, v2 }: {
  token: string; c: TokenCase; answers: AnswerMap; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; progress: Set<string>; v2?: string;
}) {
  const tuCredit = c.product_groups.includes("tu_credit");
  const fcaRequired = requiresFcaFrn(c.product_groups);
  const fields = COMPANY_FIELDS.filter((f) => !f.onlyIfTuCredit || tuCredit);
  const changeHref = (page: string) => `/m/${encodeURIComponent(token)}?page=${page}${v2 ? `&v2=${v2}` : ""}`;
  // Every step must be marked complete (clicked Continue, not "Save & continue
  // anyway") before the form can be submitted for approval. If a step was
  // skipped, offer "Save & close" instead so a first pass can be saved (items 3 & 10).
  const allComplete = visibleFormPages(c.product_groups).filter((p) => p.id !== "review").every((p) => progress.has(p.id));
  const shown = (a: AnswerMap[string] | undefined) => a?.is_unknown ? <span className="text-amber-600">Don&apos;t know (we&apos;ll follow up)</span> : (a?.value || <span className="text-neutral-400">-</span>);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[#003566]">Check your answers</h2>
        <p className="mt-0.5 text-sm text-neutral-500">Please review before submitting. You can change anything with the links on the right.</p>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
          <h3 className="text-sm font-semibold text-neutral-700">Company details</h3>
          <Link href={changeHref("company")} className="text-xs text-blue-700 hover:underline">Change</Link>
        </div>
        <dl className="divide-y divide-neutral-50">
          {fields.map((f) => (
            <div key={f.key} className="flex items-baseline gap-3 px-4 py-1.5 text-sm">
              <dt className="w-56 shrink-0 text-neutral-500">{f.label}</dt>
              <dd className="text-neutral-800">{shown(answers[f.key])}</dd>
            </div>
          ))}
          <div className="flex items-baseline gap-3 px-4 py-1.5 text-sm">
            <dt className="w-56 shrink-0 text-neutral-500">Data protection officer(s)</dt>
            <dd className="text-neutral-800">{dpoSummary(collectDpos(answers)) || <span className="text-neutral-400">-</span>}</dd>
          </div>
          <div className="flex items-baseline gap-3 px-4 py-1.5 text-sm">
            <dt className="w-56 shrink-0 text-neutral-500">Social media</dt>
            <dd className="text-neutral-800">{SOCIAL_FIELDS.filter((s) => answers[s.key]?.value).map((s) => s.label).join(", ") || <span className="text-neutral-400">-</span>}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-neutral-700">Beneficial owners</h3>
          <Link href={changeHref("ubos")} className="text-xs text-blue-700 hover:underline">Change</Link>
        </div>
        <p className="mt-1 text-neutral-600">{merchant.kyc.length} confirmed · {answers["ubo_list_complete"]?.value === "yes" ? "list confirmed complete" : <span className="text-amber-600">not yet confirmed complete</span>}</p>
      </section>

      {merchant.bankAccounts.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-neutral-700">Bank accounts</h3>
            <Link href={changeHref("accounts")} className="text-xs text-blue-700 hover:underline">Change</Link>
          </div>
          <ul className="mt-1 text-neutral-600">
            {merchant.bankAccounts.map((a) => <li key={a.id}>{a.purpose.replace(/_/g, " ")}: ••••{a.account_tail ?? "----"} {a.cop_result ? `· CoP ${a.cop_result}` : ""}</li>)}
          </ul>
        </section>
      )}

      {(requiresTransactionProfile(c.product_groups) || requiresDirectDebit(c.product_groups)) && (
        <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-neutral-700">Payment details</h3>
            <Link href={changeHref("payments")} className="text-xs text-blue-700 hover:underline">Change</Link>
          </div>
          <dl className="mt-1 space-y-0.5 text-neutral-600">
            {answers["pay_take_payments_for"]?.value && <div>Payments for: {answers["pay_take_payments_for"].value}</div>}
            {answers["pay_b2b_b2c"]?.value && <div>Model: {answers["pay_b2b_b2c"].value.toUpperCase()}</div>}
            {answers["dd_frequency"]?.value && <div>DD frequency: {answers["dd_frequency"].value}</div>}
          </dl>
        </section>
      )}

      {requiresTuSection(c.product_groups) && (
        <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-neutral-700">Information security</h3>
            <Link href={changeHref("infosec")} className="text-xs text-blue-700 hover:underline">Change</Link>
          </div>
          <p className="mt-1 text-neutral-600">
            {answers["infosec_over_10"]?.value === "yes" ? "More than 10 employees" : answers["infosec_over_10"]?.value === "no" ? "10 or fewer employees" : <span className="text-amber-600">employee size not set</span>}
            {" · "}certifications: {["iso27001", "pci", "soc2"].filter((k) => answers[`infosec_${k}`]?.value === "yes").map((k) => k.toUpperCase()).join(", ") || "none"}
          </p>
        </section>
      )}

      {requiresPolicies(c.product_groups) && (() => {
        const qs = visiblePolicyQuestions(c.product_groups);
        const answered = qs.filter((q) => (answers[q.key]?.value ?? "").trim()).length;
        const inPlace = qs.filter((q) => answers[q.key]?.value === "yes").length;
        const toFollow = qs.filter((q) => answers[`${q.key}_later`]?.value === "yes").length;
        return (
          <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-neutral-700">Policies &amp; certifications</h3>
              <Link href={changeHref("policies")} className="text-xs text-blue-700 hover:underline">Change</Link>
            </div>
            <p className="mt-1 text-neutral-600">
              {answered < qs.length
                ? <span className="text-amber-600">{answered} of {qs.length} answered</span>
                : `${qs.length} answered`}
              {" · "}{inPlace} in place{toFollow ? ` · ${toFollow} to follow` : ""}
            </p>
          </section>
        );
      })()}

      {allComplete ? (
        <form action={submitForApprovalAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="v2" value={v2 ?? ""} />
          <PendingButton className={btnPrimary} pendingLabel="Submitting…">Submit for approval</PendingButton>
          <p className="mt-2 text-xs text-neutral-400">Your information is sent securely and used only for your Credit Canary onboarding.</p>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Some steps aren&apos;t finished yet. Save your progress and come back to this link anytime - you can submit for approval once every step is complete.</p>
          <form action={saveAndCloseAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="v2" value={v2 ?? ""} />
            <PendingButton className={btnPrimary} pendingLabel="Saving…">Save &amp; close</PendingButton>
          </form>
        </div>
      )}
    </div>
  );
}

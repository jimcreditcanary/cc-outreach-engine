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
import { loadEnrichment } from "@/lib/onboarding/enrich";
import { loadMerchantForm, type TokenCase } from "@/lib/onboarding/merchantForm";
import { loadUploads } from "@/lib/onboarding/uploads";
import { requiresFcaFrn, requiresPayments, requiresDirectDebit, requiresTuSection } from "@/lib/onboarding/productGroups";
import { PendingButton } from "@/components/PendingButton";
import { AddressLookup } from "@/components/AddressLookup";
import { COMPANY_FIELDS, visibleFormPages, type AnswerFieldDef } from "./fields";
import type { FormEditorIdentity } from "@/lib/onboarding/formEditor";
import { setEditorAction, savePageAction, submitForApprovalAction } from "./actions";

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const lbl = "block text-sm font-medium text-neutral-800 mb-1";

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
      <p className="mt-1 text-sm text-neutral-600">So we can track who provided each answer, please tell us who you are. Several people can fill this in — just pick yourself each time.</p>
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
        <PendingButton className="rounded bg-[#003566] px-5 py-2 text-sm font-semibold text-white hover:bg-[#002a52]" pendingLabel="Starting…">Start →</PendingButton>
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
  const [answers, progress, enrichment, merchant, uploads] = await Promise.all([
    getAnswers(db, c.id),
    getProgress(db, c.id),
    loadEnrichment(db, c.id),
    loadMerchantForm(db, c.id),
    requiresTuSection(c.product_groups) ? loadUploads(db, c.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-[#003566]">Complete your onboarding</h1>
        <span className="text-xs text-neutral-500">Filling in as <strong>{editor.name}</strong>{editor.role ? ` (${editor.role})` : ""}</span>
      </div>

      {/* Progress bar */}
      <ol className="mt-4 flex flex-wrap gap-1.5 text-xs">
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
      {error === "save" && <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">Something went wrong saving — please try again.</p>}

      <div className="mt-5">
        {current === "company" && <CompanyPage token={token} c={c} answers={answers} v2={v2} />}
        {current === "ubos" && <UbosPage token={token} c={c} enrichment={enrichment} merchant={merchant} v2={v2} />}
        {current === "accounts" && <AccountsPage token={token} c={c} merchant={merchant} v2={v2} />}
        {current === "payments" && <PaymentsPage token={token} merchant={merchant} v2={v2} />}
        {current === "infosec" && <InfosecPage token={token} uploadCount={uploads.length} v2={v2} />}
        {current === "review" && <ReviewPage token={token} c={c} answers={answers} merchant={merchant} v2={v2} />}
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
        <button type="submit" name="mode" value="draft" className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100">Save &amp; finish later</button>
        <button type="submit" name="mode" value="continue" className="rounded bg-[#003566] px-5 py-2 text-sm font-semibold text-white hover:bg-[#002a52]">Continue →</button>
      </div>
    </form>
  );
}

function AnswerField({ def, answers, fcaRequired }: { def: AnswerFieldDef; answers: AnswerMap; fcaRequired: boolean }) {
  const a = answers[def.key];
  const required = def.required || (def.requiredIfFca && fcaRequired);
  const attr = attributionLine(a);
  return (
    <div>
      <label htmlFor={def.key} className={lbl}>{def.label}{required && <span className="text-red-600"> *</span>}</label>
      <input id={def.key} name={def.key} type={def.type ?? "text"} defaultValue={a?.value ?? ""} className={field} />
      {def.unknownOk && (
        <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" name={`${def.key}__unknown`} defaultChecked={a?.is_unknown} /> Don&apos;t know — ask later
        </label>
      )}
      {attr && <p className="mt-0.5 text-[11px] text-neutral-400">{attr}</p>}
    </div>
  );
}

// ─── Pages ───────────────────────────────────────────────────────────────────

function CompanyPage({ token, c, answers, v2 }: { token: string; c: TokenCase; answers: AnswerMap; v2?: string }) {
  const fcaRequired = requiresFcaFrn(c.product_groups);
  const tuCredit = c.product_groups.includes("tu_credit");
  const fields = COMPANY_FIELDS.filter((f) => !f.onlyIfTuCredit || tuCredit);
  return (
    <PageForm token={token} page="company" v2={v2} title="Company details" intro="Confirm your business, compliance and authorised-signatory details.">
      <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        {fields.map((f) => <AnswerField key={f.key} def={f} answers={answers} fcaRequired={fcaRequired} />)}
      </fieldset>
    </PageForm>
  );
}

function UbosPage({ token, c, enrichment, merchant, v2 }: {
  token: string; c: TokenCase; enrichment: Awaited<ReturnType<typeof loadEnrichment>>; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; v2?: string;
}) {
  const individualUbos = enrichment.ubos.filter((u) => !u.is_corporate && u.name);
  const kycByUbo = new Map(merchant.kyc.map((k) => [k.ubo_id ?? k.ubo_name, k]));
  return (
    <PageForm token={token} page="ubos" v2={v2} title="Beneficial owners" intro="Confirm the details for each person with significant control (25%+ ownership or control).">
      <input type="hidden" name="ubo_count" value={individualUbos.length} />
      {individualUbos.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">No beneficial owners are on file from Companies House. If anyone owns or controls 25%+ of the business, we&apos;ll follow up separately.</p>
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
                  <div><label className={lbl}>Date of birth</label><input type="date" name={`ubo_dob_${i}`} defaultValue={k?.date_of_birth ?? ""} className={field} /></div>
                  <div><label className={lbl}>Exact ownership %</label><input name={`ubo_pct_${i}`} defaultValue={k?.exact_ownership_percent ?? ""} placeholder="e.g. 60%" className={field} /></div>
                </div>
                <div className="mt-3">
                  <span className={lbl}>Residential address</span>
                  <AddressLookup
                    line1Name={`ubo_addr1_${i}`} line2Name={`ubo_addr2_${i}`}
                    cityName={`ubo_city_${i}`} postcodeName={`ubo_postcode_${i}`} countryName={`ubo_country_${i}`}
                    defaults={{ line1: addr.line1, line2: addr.line2, city: addr.city, postcode: addr.postcode, country: addr.country }}
                  />
                </div>
                <div className="mt-3">
                  <span className={lbl}>Politically exposed person (PEP)?</span>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1.5"><input type="radio" name={`ubo_pep_${i}`} value="no" defaultChecked={!k?.is_pep} /> No</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name={`ubo_pep_${i}`} value="yes" defaultChecked={!!k?.is_pep} /> Yes</label>
                  </div>
                  <input name={`ubo_pep_detail_${i}`} defaultValue={k?.pep_detail ?? ""} placeholder="If yes, please give brief detail" className={`${field} mt-2`} />
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
                  <input type="checkbox" name={`ubo_consent_${i}`} defaultChecked={!!k?.consent_given} className="mt-0.5" />
                  <span>This person consents to Credit Canary verifying their identity for anti-money-laundering checks.</span>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </PageForm>
  );
}

function AccountsPage({ token, c, merchant, v2 }: { token: string; c: TokenCase; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; v2?: string }) {
  const showSettle = requiresPayments(c.product_groups);
  const showDd = requiresDirectDebit(c.product_groups);
  const settleTail = merchant.bankAccounts.find((a) => a.purpose === "settlement")?.account_tail;
  const ddTail = merchant.bankAccounts.find((a) => a.purpose === "direct_debit")?.account_tail;
  return (
    <PageForm token={token} page="accounts" v2={v2} title="Bank accounts" intro="Stored encrypted and verified with Confirmation of Payee.">
      {showSettle && (
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Settlement account</legend>
          <p className="mt-1 text-xs text-neutral-500">{settleTail ? `On file: ••••${settleTail} — re-enter to change.` : "The business bank account we'll settle funds to."}</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="settle_account_name" className={lbl}>Account name</label><input id="settle_account_name" name="settle_account_name" className={field} /></div>
            <div><label htmlFor="settle_bank_name" className={lbl}>Bank</label><input id="settle_bank_name" name="settle_bank_name" className={field} /></div>
            <div><label htmlFor="settle_sort_code" className={lbl}>Sort code</label><input id="settle_sort_code" name="settle_sort_code" inputMode="numeric" placeholder="00-00-00" className={field} /></div>
            <div><label htmlFor="settle_account_number" className={lbl}>Account number</label><input id="settle_account_number" name="settle_account_number" inputMode="numeric" placeholder="8 digits" className={field} /></div>
          </div>
        </fieldset>
      )}
      {showDd && (
        <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Direct Debit collection account</legend>
          <p className="mt-1 text-xs text-neutral-500">{ddTail ? `On file: ••••${ddTail} — re-enter to change.` : "The account Direct Debit collections are paid into."}</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="dd_account_name" className={lbl}>Account name</label><input id="dd_account_name" name="dd_account_name" className={field} /></div>
            <div><label htmlFor="dd_bank_name" className={lbl}>Bank</label><input id="dd_bank_name" name="dd_bank_name" className={field} /></div>
            <div><label htmlFor="dd_sort_code" className={lbl}>Sort code</label><input id="dd_sort_code" name="dd_sort_code" inputMode="numeric" placeholder="00-00-00" className={field} /></div>
            <div><label htmlFor="dd_account_number" className={lbl}>Account number</label><input id="dd_account_number" name="dd_account_number" inputMode="numeric" placeholder="8 digits" className={field} /></div>
          </div>
        </fieldset>
      )}
    </PageForm>
  );
}

function PaymentsPage({ token, merchant, v2 }: { token: string; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; v2?: string }) {
  const dd = merchant.directDebit ?? {};
  return (
    <PageForm token={token} page="payments" v2={v2} title="Direct Debit" intro="How you collect Direct Debits through Credit Canary.">
      <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dd_collects" className={lbl}>Do you currently collect Direct Debits?</label>
          <select id="dd_collects" name="dd_collects" defaultValue={dd.collects_dd ?? ""} className={field}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>
        </div>
        <div><label htmlFor="dd_existing_sun" className={lbl}>Existing Service User Number (if any)</label><input id="dd_existing_sun" name="dd_existing_sun" defaultValue={dd.existing_sun ?? ""} className={field} /></div>
        <div className="sm:col-span-2"><label htmlFor="dd_payment_description" className={lbl}>What are you collecting payments for?</label><input id="dd_payment_description" name="dd_payment_description" defaultValue={dd.payment_description ?? ""} className={field} /></div>
        <div><label htmlFor="dd_expected_volume" className={lbl}>Expected monthly volume</label><input id="dd_expected_volume" name="dd_expected_volume" defaultValue={dd.expected_monthly_volume ?? ""} className={field} /></div>
        <div><label htmlFor="dd_average_value" className={lbl}>Average collection value</label><input id="dd_average_value" name="dd_average_value" defaultValue={dd.average_value ?? ""} className={field} /></div>
      </fieldset>
    </PageForm>
  );
}

function InfosecPage({ token, uploadCount, v2 }: { token: string; uploadCount: number; v2?: string }) {
  return (
    <PageForm token={token} page="infosec" v2={v2} title="Information security" intro="Upload any security certifications, policies or penetration-test summaries. Optional, but it speeds up review.">
      <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
        {uploadCount > 0 && <p className="mb-2 text-sm text-neutral-500">{uploadCount} already uploaded.</p>}
        <input type="file" name="infosec_files" multiple accept=".pdf,.doc,.docx,.txt,.md" className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-[#003566] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#002a52]" />
      </fieldset>
    </PageForm>
  );
}

function ReviewPage({ token, c, answers, merchant, v2 }: {
  token: string; c: TokenCase; answers: AnswerMap; merchant: Awaited<ReturnType<typeof loadMerchantForm>>; v2?: string;
}) {
  const tuCredit = c.product_groups.includes("tu_credit");
  const fcaRequired = requiresFcaFrn(c.product_groups);
  const fields = COMPANY_FIELDS.filter((f) => !f.onlyIfTuCredit || tuCredit);
  const changeHref = (page: string) => `/m/${encodeURIComponent(token)}?page=${page}${v2 ? `&v2=${v2}` : ""}`;
  const shown = (a: AnswerMap[string] | undefined) => a?.is_unknown ? <span className="text-amber-600">Don&apos;t know (we&apos;ll follow up)</span> : (a?.value || <span className="text-neutral-400">—</span>);

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
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-neutral-700">Beneficial owners</h3>
          <Link href={changeHref("ubos")} className="text-xs text-blue-700 hover:underline">Change</Link>
        </div>
        <p className="mt-1 text-neutral-600">{merchant.kyc.length} confirmed.</p>
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

      <form action={submitForApprovalAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="v2" value={v2 ?? ""} />
        <PendingButton className="rounded bg-[#003566] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002a52]" pendingLabel="Submitting…">Submit for approval</PendingButton>
        <p className="mt-2 text-xs text-neutral-400">Required fields must be complete (or marked &ldquo;don&apos;t know&rdquo;). Your information is sent securely and used only for your Credit Canary onboarding.</p>
      </form>
    </div>
  );
}

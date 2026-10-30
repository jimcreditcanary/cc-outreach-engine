// Public merchant onboarding form at /m/<token>. No auth — the unguessable
// merchant_form_token is the credential. Shows the Companies-House-pre-filled
// entity/people (read-only) and collects the merchant-completed fields +
// per-UBO KYC. Renders standalone (the root layout drops the app nav when the
// viewer isn't signed in). Accessible: labelled fields, fieldsets, one submit.

import type { ReactNode } from "react";
import { serviceClient } from "@/lib/db/client";
import { getCaseByToken, loadMerchantForm, markFormOpened } from "@/lib/onboarding/merchantForm";
import { loadEnrichment } from "@/lib/onboarding/enrich";
import { requiresFcaFrn, requiresPayments, requiresDirectDebit, requiresTuSection } from "@/lib/onboarding/productGroups";
import { loadUploads } from "@/lib/onboarding/uploads";
import { PendingButton } from "@/components/PendingButton";
import { AddressLookup } from "@/components/AddressLookup";
import { submitMerchantFormAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const lbl = "block text-sm font-medium text-neutral-800 mb-1";

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="bg-[#003566] px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#FFD600] text-sm font-bold text-[#003566]">CC</div>
          <span className="font-semibold text-white">Credit Canary</span>
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
    </main>
  );
}

export default async function MerchantFormPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);

  if (!c) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-[#003566]">Link not recognised</h1>
        <p className="mt-2 text-sm text-neutral-600">This onboarding link looks incomplete or has expired. Please reply to the email we sent and we&apos;ll sort it out.</p>
      </Shell>
    );
  }

  const alreadyDone = sp.done === "1" || c.status === "merchant_submitted";
  if (alreadyDone) {
    return (
      <Shell>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
          <h1 className="text-xl font-semibold text-[#003566]">Thank you — that&apos;s submitted ✓</h1>
          <p className="mt-2 text-sm text-neutral-700">We&apos;ve received your onboarding details and ownership information. Our team will review and be in touch with the next steps. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  await markFormOpened(db, c.id, c.status);
  const [enrichment, { form, kyc, bankAccounts, directDebit }] = await Promise.all([
    loadEnrichment(db, c.id),
    loadMerchantForm(db, c.id),
  ]);
  const snapshot = enrichment.snapshot;

  const individualUbos = enrichment.ubos.filter((u) => !u.is_corporate && u.name);
  const kycByUbo = new Map(kyc.map((k) => [k.ubo_id ?? k.ubo_name, k]));
  const fcaRequired = requiresFcaFrn(c.product_groups);
  const needsPrincipalOffice = c.product_groups.includes("tu_credit");
  const showPayments = requiresPayments(c.product_groups);
  const showDD = requiresDirectDebit(c.product_groups);
  const showInfosec = requiresTuSection(c.product_groups);
  const uploads = showInfosec ? await loadUploads(db, c.id) : [];
  const b = form?.business ?? {};
  const comp = form?.compliance ?? {};
  const sig = form?.signatory ?? {};
  const dd = directDebit ?? {};
  const settleTail = bankAccounts.find((a) => a.purpose === "settlement")?.account_tail;
  const ddTail = bankAccounts.find((a) => a.purpose === "direct_debit")?.account_tail;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-[#003566]">Complete your onboarding</h1>
      <p className="mt-1 text-sm text-neutral-600">A few details to get you set up. We&apos;ve pre-filled what we can from Companies House — please confirm the rest. It takes about 10–15 minutes.</p>

      {sp.error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {sp.error === "save" ? "Something went wrong saving your form — please try again." : "We couldn't match this link."}
        </p>
      )}

      {/* Entity — read-only from Companies House */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Your company (from Companies House)</h2>
        {snapshot ? (
          <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-neutral-400">Name</dt><dd className="text-neutral-800">{snapshot.company_name ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Company number</dt><dd className="text-neutral-800">{snapshot.company_number}</dd></div>
            <div><dt className="text-neutral-400">Type</dt><dd className="text-neutral-800">{snapshot.company_type ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Status</dt><dd className="text-neutral-800">{snapshot.company_status ?? "—"}</dd></div>
          </dl>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">Company number {c.company_number ?? "—"}.</p>
        )}
      </section>

      <form action={submitMerchantFormAction} className="mt-6 space-y-6">
        <input type="hidden" name="token" value={token} />

        {/* Business details */}
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Business details</legend>
          <div className="mt-2 space-y-3">
            <div><label htmlFor="trading_name" className={lbl}>Trading name(s)</label><input id="trading_name" name="trading_name" defaultValue={b.trading_name ?? ""} className={field} /></div>
            <div><label htmlFor="trading_address" className={lbl}>Trading address</label><input id="trading_address" name="trading_address" defaultValue={b.trading_address ?? ""} className={field} /></div>
            {needsPrincipalOffice && (
              <div><label htmlFor="principal_office" className={lbl}>Principal office address</label><input id="principal_office" name="principal_office" defaultValue={b.principal_office ?? ""} className={field} /></div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label htmlFor="phone" className={lbl}>Phone</label><input id="phone" name="phone" type="tel" defaultValue={b.phone ?? ""} className={field} /></div>
              <div><label htmlFor="email" className={lbl}>Email</label><input id="email" name="email" type="email" defaultValue={b.email ?? ""} className={field} /></div>
            </div>
            <div><label htmlFor="website" className={lbl}>Website</label><input id="website" name="website" type="url" placeholder="https://" defaultValue={b.website ?? ""} className={field} /></div>
          </div>
        </fieldset>

        {/* Compliance */}
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Compliance</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="ico_number" className={lbl}>ICO registration number</label><input id="ico_number" name="ico_number" defaultValue={comp.ico_number ?? ""} className={field} /></div>
            <div>
              <label htmlFor="fca_frn" className={lbl}>FCA FRN{fcaRequired && <span className="text-red-600"> *</span>}</label>
              <input id="fca_frn" name="fca_frn" required={fcaRequired} defaultValue={comp.fca_frn ?? ""} className={field} />
            </div>
            <div><label htmlFor="dpo" className={lbl}>Data protection officer</label><input id="dpo" name="dpo" defaultValue={comp.dpo ?? ""} className={field} /></div>
            <div><label htmlFor="trade_body" className={lbl}>Trade-body membership</label><input id="trade_body" name="trade_body" defaultValue={comp.trade_body ?? ""} className={field} /></div>
            <div className="sm:col-span-2"><label htmlFor="privacy_policy_url" className={lbl}>Privacy-policy URL</label><input id="privacy_policy_url" name="privacy_policy_url" type="url" placeholder="https://" defaultValue={comp.privacy_policy_url ?? ""} className={field} /></div>
          </div>
        </fieldset>

        {/* Authorised signatory */}
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Authorised signatory</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label htmlFor="signatory_name" className={lbl}>Full name</label><input id="signatory_name" name="signatory_name" defaultValue={sig.name ?? ""} className={field} /></div>
            <div><label htmlFor="signatory_title" className={lbl}>Title / role</label><input id="signatory_title" name="signatory_title" defaultValue={sig.title ?? ""} className={field} /></div>
            <div><label htmlFor="signatory_email" className={lbl}>Email</label><input id="signatory_email" name="signatory_email" type="email" defaultValue={sig.email ?? ""} className={field} /></div>
          </div>
        </fieldset>

        {/* Settlement account */}
        {showPayments && (
          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
            <legend className="px-1 text-sm font-semibold text-[#003566]">Settlement account</legend>
            <p className="mt-1 text-xs text-neutral-500">
              The business bank account we&apos;ll settle funds to. Stored encrypted and verified with Confirmation of Payee.
              {settleTail ? ` On file: ••••${settleTail} — re-enter to change.` : ""}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label htmlFor="settle_account_name" className={lbl}>Account name</label><input id="settle_account_name" name="settle_account_name" className={field} /></div>
              <div><label htmlFor="settle_bank_name" className={lbl}>Bank</label><input id="settle_bank_name" name="settle_bank_name" className={field} /></div>
              <div><label htmlFor="settle_sort_code" className={lbl}>Sort code</label><input id="settle_sort_code" name="settle_sort_code" inputMode="numeric" placeholder="00-00-00" className={field} /></div>
              <div><label htmlFor="settle_account_number" className={lbl}>Account number</label><input id="settle_account_number" name="settle_account_number" inputMode="numeric" placeholder="8 digits" className={field} /></div>
            </div>
          </fieldset>
        )}

        {/* Direct Debit */}
        {showDD && (
          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
            <legend className="px-1 text-sm font-semibold text-[#003566]">Direct Debit</legend>
            <p className="mt-1 text-xs text-neutral-500">Details for collecting Direct Debits through Credit Canary.</p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="dd_collects" className={lbl}>Do you currently collect Direct Debits?</label>
                <select id="dd_collects" name="dd_collects" defaultValue={dd.collects_dd ?? ""} className={field}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>
              <div><label htmlFor="dd_existing_sun" className={lbl}>Existing Service User Number (if any)</label><input id="dd_existing_sun" name="dd_existing_sun" defaultValue={dd.existing_sun ?? ""} className={field} /></div>
              <div className="sm:col-span-2"><label htmlFor="dd_payment_description" className={lbl}>What are you collecting payments for?</label><input id="dd_payment_description" name="dd_payment_description" defaultValue={dd.payment_description ?? ""} className={field} /></div>
              <div><label htmlFor="dd_expected_volume" className={lbl}>Expected monthly volume</label><input id="dd_expected_volume" name="dd_expected_volume" defaultValue={dd.expected_monthly_volume ?? ""} className={field} /></div>
              <div><label htmlFor="dd_average_value" className={lbl}>Average collection value</label><input id="dd_average_value" name="dd_average_value" defaultValue={dd.average_value ?? ""} className={field} /></div>
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-700">Collection bank account{ddTail ? ` (on file: ••••${ddTail})` : ""}</p>
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label htmlFor="dd_account_name" className={lbl}>Account name</label><input id="dd_account_name" name="dd_account_name" className={field} /></div>
              <div><label htmlFor="dd_bank_name" className={lbl}>Bank</label><input id="dd_bank_name" name="dd_bank_name" className={field} /></div>
              <div><label htmlFor="dd_sort_code" className={lbl}>Sort code</label><input id="dd_sort_code" name="dd_sort_code" inputMode="numeric" placeholder="00-00-00" className={field} /></div>
              <div><label htmlFor="dd_account_number" className={lbl}>Account number</label><input id="dd_account_number" name="dd_account_number" inputMode="numeric" placeholder="8 digits" className={field} /></div>
            </div>
          </fieldset>
        )}

        {/* Beneficial owners */}
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Beneficial owners</legend>
          <input type="hidden" name="ubo_count" value={individualUbos.length} />
          {individualUbos.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No beneficial owners are on file from Companies House. If anyone owns or controls 25% or more of the business, we&apos;ll follow up separately.</p>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">Please confirm the details for each person with significant control.</p>
          )}
          <div className="mt-3 space-y-4">
            {individualUbos.map((u, i) => {
              const k = kycByUbo.get(u.id) ?? kycByUbo.get(u.name ?? "");
              const addr = k?.residential_address ?? {};
              return (
                <div key={u.id} className="rounded border border-neutral-200 p-3">
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
        </fieldset>

        {/* Information security */}
        {showInfosec && (
          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
            <legend className="px-1 text-sm font-semibold text-[#003566]">Information security</legend>
            <p className="mt-1 text-sm text-neutral-500">
              Upload any security certifications, policies or penetration-test summaries (PDF, Word, or text). Optional, but it speeds up review.
              {uploads.length > 0 && ` ${uploads.length} already uploaded.`}
            </p>
            <input type="file" name="infosec_files" multiple accept=".pdf,.doc,.docx,.txt,.md" className="mt-2 block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-[#003566] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#002a52]" />
          </fieldset>
        )}

        <PendingButton className="rounded bg-[#003566] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002a52]" pendingLabel="Submitting…">
          Submit onboarding details
        </PendingButton>
        <p className="text-xs text-neutral-400">Your information is sent securely and used only for your Credit Canary onboarding.</p>
      </form>
    </Shell>
  );
}

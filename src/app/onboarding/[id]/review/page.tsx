// Phase 3 internal review — what the merchant submitted (business details,
// compliance, signatory, per-UBO KYC, bank accounts with CoP, DD), plus the AI
// outputs: privacy-policy assessment and infosec-upload extractions. Bank
// numbers are shown only as the masked tail (never decrypted here).

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { getCase } from "@/lib/onboarding/cases";
import { loadMerchantForm } from "@/lib/onboarding/merchantForm";
import { loadPrivacyAssessment } from "@/lib/onboarding/privacyAssessment";
import { loadUploads } from "@/lib/onboarding/uploads";
import { loadUboChecks } from "@/lib/onboarding/uboChecks";
import { loadGeneratedDocs } from "@/lib/onboarding/docgen";
import { caseDriveFolderUrl } from "@/lib/onboarding/driveFiling";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { assessPrivacyPolicyAction, extractUploadAction, runUboChecksAction, generateDocsAction, approveCaseAction, fileToDriveAction } from "../../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function kb(n: number | null): string {
  if (!n) return "";
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

function copBadge(r: string | null) {
  const cls = r === "match" ? "bg-emerald-100 text-emerald-800" : r === "close_match" ? "bg-amber-100 text-amber-800" : r === "no_match" ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>CoP: {r ? r.replace(/_/g, " ") : "—"}</span>;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) notFound();

  const [{ form, kyc, bankAccounts, directDebit }, privacy, uploads, uboChecks, generatedDocs] = await Promise.all([
    loadMerchantForm(db, id),
    loadPrivacyAssessment(db, id),
    loadUploads(db, id),
    loadUboChecks(db, id),
    loadGeneratedDocs(db, id),
  ]);
  const driveUrl = await caseDriveFolderUrl(db, id);

  const b = form?.business ?? {};
  const comp = form?.compliance ?? {};
  const sig = form?.signatory ?? {};
  const pr = privacy?.result ?? null;

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href={`/onboarding/${id}`} className="text-sm text-blue-700 hover:underline">← Case</Link>
      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Merchant submission</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {c.company_number ? `Company ${c.company_number}` : "—"} · status {c.status.replace(/_/g, " ")}
            {form?.submitted_at && ` · submitted ${fmtDateTime(form.submitted_at)}`}
          </p>
        </div>
        {c.status === "onboarded" ? (
          <span className="rounded bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800">✓ Onboarded</span>
        ) : (
          <form action={approveCaseAction}>
            <input type="hidden" name="case_id" value={id} />
            <PendingButton className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700" pendingLabel="Approving…">
              ✓ Approve onboarding
            </PendingButton>
          </form>
        )}
      </header>

      {!form ? (
        <p className="text-neutral-500">The merchant hasn&apos;t submitted the form yet.</p>
      ) : (
        <div className="space-y-6">
          {/* Documents (P5) */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Documents</h2>
              <form action={generateDocsAction}>
                <input type="hidden" name="case_id" value={id} />
                <PendingButton className="rounded bg-[#003566] px-3 py-1 text-xs font-medium text-white hover:bg-[#002a52]" pendingLabel="Generating…">
                  {generatedDocs.length ? "Regenerate" : "✨ Generate documents"}
                </PendingButton>
              </form>
              {generatedDocs.length > 0 && (
                <form action={fileToDriveAction}>
                  <input type="hidden" name="case_id" value={id} />
                  <PendingButton className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Filing…">
                    📁 File to Drive
                  </PendingButton>
                </form>
              )}
              {driveUrl && <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">Open Drive folder ↗</a>}
            </div>
            {generatedDocs.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-400">Not generated yet — fills the branded templates for this product selection with the case data.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {generatedDocs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <a href={`/onboarding/${id}/doc/${d.id}`} className="font-medium text-blue-700 hover:underline">⬇ {d.filename}</a>
                    <span className="text-xs text-neutral-400">{fmtDateTime(d.generated_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Business + compliance + signatory */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Cell label="Trading name">{b.trading_name}</Cell>
            <Cell label="Trading address">{b.trading_address}</Cell>
            <Cell label="Phone">{b.phone}</Cell>
            <Cell label="Email">{b.email}</Cell>
            <Cell label="Website">{b.website}</Cell>
            <Cell label="Principal office">{b.principal_office}</Cell>
            <Cell label="ICO number">{comp.ico_number}</Cell>
            <Cell label="FCA FRN">{comp.fca_frn}</Cell>
            <Cell label="DPO">{comp.dpo}</Cell>
            <Cell label="Trade body">{comp.trade_body}</Cell>
            <Cell label="Privacy policy">{comp.privacy_policy_url}</Cell>
            <Cell label="Signatory">{[sig.name, sig.title, sig.email].filter(Boolean).join(" · ")}</Cell>
          </section>

          {/* UBO KYC */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Beneficial owners ({kyc.length})</h2>
            {kyc.length === 0 ? <p className="text-sm text-neutral-400">None submitted.</p> : (
              <ul className="space-y-2">
                {kyc.map((k) => {
                  const a = k.residential_address ?? {};
                  const addr = [a.line1, a.line2, a.city, a.postcode, a.country].filter(Boolean).join(", ");
                  return (
                    <li key={k.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-800">{k.ubo_name}</span>
                        {k.exact_ownership_percent && <span className="text-neutral-500">{k.exact_ownership_percent}</span>}
                        {k.is_pep && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">PEP</span>}
                        <span className={`rounded px-1.5 py-0.5 text-xs ${k.consent_given ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>consent {k.consent_given ? "✓" : "✗"}</span>
                      </div>
                      {addr && <div className="mt-0.5 text-xs text-neutral-500">{addr}</div>}
                      {k.is_pep && k.pep_detail && <div className="mt-0.5 text-xs text-amber-700">{k.pep_detail}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Identity & screening (P4) */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Identity &amp; screening</h2>
              <form action={runUboChecksAction}>
                <input type="hidden" name="case_id" value={id} />
                <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Running…">
                  {uboChecks.length ? "Re-run" : "✨ Run UBO checks"}
                </PendingButton>
              </form>
            </div>
            {uboChecks.length === 0 ? (
              <p className="text-sm text-neutral-400">Not run yet. Verifies each owner&apos;s identity and screens for PEP / sanctions (Call Validate).</p>
            ) : (
              <ul className="space-y-2">
                {uboChecks.map((ch) => (
                  <li key={ch.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">{ch.ubo_name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ch.idv_band === "pass" ? "bg-emerald-100 text-emerald-800" : ch.idv_band === "refer" ? "bg-amber-100 text-amber-800" : ch.idv_band === "fail" ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500"}`}>
                        ID&amp;V: {ch.idv_band ?? "—"}{ch.idv_score != null ? ` (${ch.idv_score})` : ""}
                      </span>
                      {ch.pep_match && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">PEP</span>}
                      {ch.sanctions_match && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">Sanctions</span>}
                    </div>
                    {ch.screening_detail?.matches && ch.screening_detail.matches.length > 0 && (
                      <ul className="mt-1 text-xs text-red-700">
                        {ch.screening_detail.matches.map((m, i) => <li key={i}>{m.type}: {m.name}{m.detail ? ` — ${m.detail}` : ""}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Bank + DD */}
          {(bankAccounts.length > 0 || directDebit) && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Payments</h2>
              <ul className="space-y-2">
                {bankAccounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{a.purpose.replace(/_/g, " ")}</span>
                    <span className="font-medium text-neutral-800">{a.account_name ?? "—"}</span>
                    {a.bank_name && <span className="text-neutral-500">{a.bank_name}</span>}
                    {a.account_tail && <span className="text-neutral-500">••••{a.account_tail}</span>}
                    {copBadge(a.cop_result)}
                    {a.cop_matched_name && a.cop_result !== "match" && <span className="text-xs text-neutral-400">matched: {a.cop_matched_name}</span>}
                  </li>
                ))}
              </ul>
              {directDebit && (
                <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-600">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Direct Debit</div>
                  <p className="mt-0.5">{[
                    directDebit.collects_dd && `collects DDs: ${directDebit.collects_dd}`,
                    directDebit.existing_sun && `SUN ${directDebit.existing_sun}`,
                    directDebit.payment_description,
                    directDebit.expected_monthly_volume && `~${directDebit.expected_monthly_volume}/mo`,
                    directDebit.average_value && `avg ${directDebit.average_value}`,
                  ].filter(Boolean).join(" · ") || "—"}</p>
                </div>
              )}
            </section>
          )}

          {/* Privacy assessment */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Privacy-policy assessment</h2>
              <form action={assessPrivacyPolicyAction}>
                <input type="hidden" name="case_id" value={id} />
                <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Assessing…">
                  {pr ? "Re-assess" : "✨ Assess"}
                </PendingButton>
              </form>
              {privacy?.assessed_at && <span className="text-xs text-neutral-400">{fmtDateTime(privacy.assessed_at)}</span>}
            </div>
            {!pr ? (
              <p className="text-sm text-neutral-400">Not assessed yet. The privacy-policy URL is read and scored against GDPR / TU requirements.</p>
            ) : (
              <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${pr.overall === "adequate" ? "bg-emerald-100 text-emerald-800" : pr.overall === "minor_gaps" ? "bg-amber-100 text-amber-800" : pr.overall === "inadequate" ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500"}`}>{pr.overall.replace(/_/g, " ")}</span>
                  <span className="text-neutral-700">{pr.summary}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(pr.coverage).map(([k, v]) => (
                    <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] ${v ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}>{k.replace(/_/g, " ")}{v ? " ✓" : " ✗"}</span>
                  ))}
                </div>
                {pr.gaps.length > 0 && <p className="mt-2 text-xs text-amber-700">Gaps: {pr.gaps.join("; ")}</p>}
                {pr.concerns.length > 0 && <p className="mt-1 text-xs text-red-700">Concerns: {pr.concerns.join("; ")}</p>}
              </div>
            )}
          </section>

          {/* Infosec uploads */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Infosec documents ({uploads.length})</h2>
            {uploads.length === 0 ? <p className="text-sm text-neutral-400">None uploaded.</p> : (
              <ul className="space-y-2">
                {uploads.map((u) => (
                  <li key={u.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">{u.filename}</span>
                      <span className="text-xs text-neutral-400">{kb(u.size_bytes)} · {fmtDate(u.created_at)}</span>
                      <form action={extractUploadAction} className="ml-auto">
                        <input type="hidden" name="case_id" value={id} />
                        <input type="hidden" name="upload_id" value={u.id} />
                        <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Extracting…">
                          {u.extracted ? "Re-extract" : "✨ Extract"}
                        </PendingButton>
                      </form>
                    </div>
                    {u.extracted && (
                      <div className="mt-2 text-xs text-neutral-600">
                        {u.extracted.document_type && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">{u.extracted.document_type}</span>}
                        {u.extracted.summary && <p className="mt-1 text-neutral-700">{u.extracted.summary}</p>}
                        {u.extracted.security_controls?.length > 0 && <p className="mt-1">Controls: {u.extracted.security_controls.join(", ")}</p>}
                        {u.extracted.dates?.length > 0 && <p className="mt-0.5">Dates: {u.extracted.dates.join(", ")}</p>}
                        {u.extracted.flags?.length > 0 && <p className="mt-0.5 text-amber-700">Flags: {u.extracted.flags.join("; ")}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Cell({ label, children }: { label: string; children?: string | null }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 break-words text-sm text-neutral-800">{children || <span className="text-neutral-300">—</span>}</div>
    </div>
  );
}

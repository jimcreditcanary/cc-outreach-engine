// Shared onboarding-case UI, extracted so it renders both at /onboarding/[id]
// (standalone, for back-compat/deep links) AND inside the Onboarding tab on
// /companies/[id] (the primary home — feedback items 2-4). All intra-onboarding
// links go through a `nav` object so the same components build the right hrefs
// in either place. Sub-routes (/enrichment, /doc/[id]) stay standalone and are
// linked as-is. Server actions still redirect to /onboarding/[id]* which now
// redirects on to the company tab.

import type { ReactNode } from "react";
import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { getDeal, hubspotRepo } from "@/lib/hubspot/repo";
import { getCompaniesHouse, type ChCompanySearchResult } from "@/lib/integrations/companiesHouse";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import type { ContactRecord } from "@/lib/crm/types";
import {
  getCase, listStakeholders, listCaseEvents, stepStatus, firstIncompleteStep, readyToComplete,
  WIZARD_STEPS, ONBOARDING_ROLES, type WizardStepId, type OnboardingCase, type Stakeholder,
} from "@/lib/onboarding/cases";
import {
  PRODUCT_GROUPS, PRODUCT_GROUP_KEYS, lockedSelections,
  isLightTouch, requiresFullKyc, requiresTuSection, requiresPayments,
  requiresDirectDebit, requiresFcaFrn, documentsFor, type OnboardingDocKind,
} from "@/lib/onboarding/productGroups";
import {
  saveCompanyAction, saveProductsAction, addStakeholderAction, removeStakeholderAction,
  completeInternalAction, cancelCaseAction, addContactToCompanyAction, pullOfficersUbosAction,
  assessPrivacyPolicyAction, extractUploadAction, runUboChecksAction, requestUboDocsAction,
  generateDocsAction, approveCaseAction, fileToDriveAction,
} from "../actions";
import { merchantFormUrl, loadMerchantForm } from "@/lib/onboarding/merchantForm";
import { loadGeneratedDocs, type GeneratedDoc } from "@/lib/onboarding/docgen";
import { loadEnrichment, distinctIndividualUbos } from "@/lib/onboarding/enrich";
import { loadPrivacyAssessment } from "@/lib/onboarding/privacyAssessment";
import { loadUploads } from "@/lib/onboarding/uploads";
import { loadUboChecks } from "@/lib/onboarding/uboChecks";
import { loadUboDocRequests, loadUboDocs, uboUploadUrl } from "@/lib/onboarding/uboDocs";
import { caseDriveFolderUrl } from "@/lib/onboarding/driveFiling";
import { parsePersonName, nameMatchKey } from "@/lib/onboarding/personName";
import { getCrm } from "@/lib/crm";
import { AssignRoleForm } from "./AssignRoleForm";
import { CopyButton } from "@/components/CopyButton";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

// Link builder so the same components work standalone and inside the company tab.
export interface OnbNav {
  caseHref: string;                      // the case "home"
  stepHref: (step: string) => string;    // a wizard step
  reviewHref: string;                    // the review/approve view
  enrichHref: string;                    // Companies House enrichment (standalone sub-route)
  docHref: (docId: string) => string;    // document download (standalone sub-route)
  searchHidden: { name: string; value: string }[]; // hidden fields for the GET company-search form
}

/** Nav for the standalone /onboarding/[id] route. */
export function standaloneNav(caseId: string): OnbNav {
  const base = `/onboarding/${caseId}`;
  return {
    caseHref: base,
    stepHref: (s) => `${base}?step=${s}`,
    reviewHref: `${base}/review`,
    enrichHref: `${base}/enrichment`,
    docHref: (d) => `${base}/doc/${d}`,
    searchHidden: [{ name: "step", value: "company" }],
  };
}

/** Nav for the Onboarding tab on /companies/[id]. */
export function companyTabNav(companyId: string, caseId: string): OnbNav {
  const base = `/companies/${companyId}?tab=onboarding`;
  return {
    caseHref: base,
    stepHref: (s) => `${base}&step=${s}`,
    reviewHref: `${base}&ob=review`,
    enrichHref: `/onboarding/${caseId}/enrichment`,
    docHref: (d) => `/onboarding/${caseId}/doc/${d}`,
    searchHidden: [{ name: "tab", value: "onboarding" }, { name: "step", value: "company" }],
  };
}

const DOC_LABELS: Record<OnboardingDocKind, string> = {
  tu_credit_eua: "TU Credit EUA",
  tu_monevo_eua: "TU Monevo EUA",
  tu_due_diligence_xlsx: "TU Due Diligence (xlsx)",
  merchant_onboarding_form: "Merchant Onboarding Form",
  dd_questionnaire: "DD Questionnaire",
};

const EVENT_LABELS: Record<string, string> = {
  case_created: "Case created", company_confirmed: "Company confirmed", products_set: "Products selected",
  stakeholder_added: "Stakeholder added", stakeholder_removed: "Stakeholder removed", contact_created: "Contact created",
  ch_enriched: "Companies House enrichment", accounts_parsed: "Accounts parsed", internal_complete: "Internal onboarding completed",
  customer_link_ready: "Customer link created", api_sandbox_requested: "API sandbox requested", merchant_submitted: "Customer submitted form",
  privacy_assessed: "Privacy policy assessed", docs_generated: "Documents generated", drive_filed: "Filed to Google Drive",
  ubo_checks_run: "UBO checks run", approved: "Approved & onboarded", cancelled: "Cancelled",
};
const humanEvent = (e: string): string => EVENT_LABELS[e] ?? e.replace(/_/g, " ");

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "onboarded" ? "bg-emerald-100 text-emerald-800"
    : status === "cancelled" ? "bg-neutral-200 text-neutral-600"
    : status === "started" ? "bg-amber-100 text-amber-800"
    : "bg-blue-100 text-blue-800";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

// ─── Wizard panel ────────────────────────────────────────────────────────────

export async function OnboardingCasePanel({ caseId, nav, step: stepParam, q, companyName }: {
  caseId: string; nav: OnbNav; step?: string; q?: string; companyName?: string;
}) {
  const db = serviceClient();
  const c = await getCase(db, caseId);
  if (!c) return <p className="text-sm text-neutral-500">Onboarding case not found.</p>;

  const stakeholders = await listStakeholders(db, caseId);
  const deal = c.hubspot_deal_id ? await getDeal(c.hubspot_deal_id) : null;
  const docs = await loadGeneratedDocs(db, caseId).catch(() => []);
  const done = stepStatus(c, stakeholders.length);

  const validStep = (s: string | undefined): s is WizardStepId => !!s && WIZARD_STEPS.some((w) => w.id === s);
  const step: WizardStepId = validStep(stepParam) ? stepParam : firstIncompleteStep(c, stakeholders.length);
  const locked = c.status !== "started" && c.status !== "internal_complete";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-lg font-semibold text-neutral-800">{deal?.name || "Onboarding case"}</h2>
        <StatusBadge status={c.status} />
        {deal?.url && <a href={deal.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">deal in HubSpot ↗</a>}
        <span className="text-sm text-neutral-500">
          {c.company_number ? `· Company ${c.company_number}` : "· No company confirmed yet"}
          {" · "}{c.product_groups.length} product group{c.product_groups.length === 1 ? "" : "s"}
          {" · "}{stakeholders.length} stakeholder{stakeholders.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Step indicator */}
      <nav className="mb-6 flex flex-wrap gap-1">
        {WIZARD_STEPS.map((w) => {
          const active = w.id === step;
          const complete = done[w.id];
          return (
            <Link
              key={w.id}
              href={nav.stepHref(w.id)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                active ? "bg-amber-600 text-white"
                : complete ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${active ? "bg-white/25" : complete ? "bg-emerald-200 text-emerald-900" : "bg-neutral-300 text-neutral-700"}`}>
                {complete ? "✓" : w.n}
              </span>
              {w.label}
            </Link>
          );
        })}
      </nav>

      {step === "company" && <CompanyStep c={c} deal={deal} q={q} nav={nav} companyName={companyName} />}
      {step === "products" && <ProductsStep c={c} />}
      {step === "stakeholders" && <StakeholdersStep c={c} stakeholders={stakeholders} nav={nav} />}
      {step === "finish" && <FinishStep c={c} stakeholders={stakeholders} locked={locked} generatedDocs={docs} nav={nav} />}
    </div>
  );
}

// ─── Step 1: Company ─────────────────────────────────────────────────────────

async function CompanyStep({ c, deal, q, nav, companyName }: { c: OnboardingCase; deal: { name: string | null } | null; q?: string; nav: OnbNav; companyName?: string }) {
  const query = (q ?? "").trim();
  let results: ChCompanySearchResult[] = [];
  let searchError: string | null = null;
  if (query) {
    try { results = await getCompaniesHouse().searchCompanies(query, 10); }
    catch (e) { searchError = e instanceof Error ? e.message : "search failed"; }
  }

  return (
    <section className="max-w-2xl">
      <h2 className="mb-1 font-semibold">Confirm the company</h2>
      <p className="mb-3 text-sm text-neutral-500">Search Companies House and pick the legal entity behind this deal. Deep enrichment (officers, PSCs, accounts) comes in the next phase.</p>

      {c.company_number && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
          <span className="text-emerald-800">✓ Confirmed: company number <strong>{c.company_number}</strong></span>
          <Link href={nav.enrichHref} className="ml-auto text-blue-700 hover:underline">Companies House enrichment →</Link>
          <Link href={nav.stepHref("products")} className="text-blue-700 hover:underline">Next: products →</Link>
        </div>
      )}

      <form method="get" className="mb-4 flex gap-2">
        {nav.searchHidden.map((h) => <input key={h.name} type="hidden" name={h.name} value={h.value} />)}
        <input name="q" defaultValue={query || companyName || deal?.name || ""} placeholder="Company name or number…" className={field} />
        <button className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Search</button>
      </form>

      {searchError && (
        <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Companies House search failed: {searchError}. Try again, or check the API key is set.
        </p>
      )}
      {query && !searchError && results.length === 0 && <p className="text-sm text-neutral-400">No matches for “{query}”.</p>}
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.company_number} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-neutral-800">{r.title}</div>
              <div className="text-xs text-neutral-500">
                {r.company_number}{r.company_status ? ` · ${r.company_status}` : ""}{r.address_snippet ? ` · ${r.address_snippet}` : ""}
              </div>
            </div>
            <form action={saveCompanyAction}>
              <input type="hidden" name="case_id" value={c.id} />
              <input type="hidden" name="company_number" value={r.company_number} />
              <PendingButton
                className={`rounded px-3 py-1.5 text-xs font-medium ${c.company_number === r.company_number ? "border border-emerald-300 text-emerald-700" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                pendingLabel="Saving…"
              >
                {c.company_number === r.company_number ? "Selected" : "Use this company"}
              </PendingButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Step 2: Products ──────────────────────────────────────────────────────────

function ProductsStep({ c }: { c: OnboardingCase }) {
  const selected = new Set(c.product_groups);
  const locked = lockedSelections(c.product_groups);
  return (
    <section className="max-w-2xl">
      <h2 className="mb-1 font-semibold">Product groups</h2>
      <p className="mb-3 text-sm text-neutral-500">
        What are they being onboarded for? Selecting <strong>Settlement Accounts</strong> includes Faster Payments. Any “full” product triggers the full KYC path; Open Banking and Confirmation of Payee alone take the light-touch path (basic Companies House check only).
      </p>
      <form action={saveProductsAction} className="space-y-2">
        <input type="hidden" name="case_id" value={c.id} />
        {PRODUCT_GROUP_KEYS.map((k) => {
          const g = PRODUCT_GROUPS[k];
          const isLocked = locked.has(k);
          const checked = selected.has(k) || isLocked;
          return (
            <label key={k} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2.5 text-sm">
              <input type="checkbox" name="groups" value={k} defaultChecked={checked} className="h-4 w-4" />
              <span className="font-medium text-neutral-800">{g.label}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${g.weight === "full" ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-500"}`}>{g.weight}</span>
              {g.autoSelects?.length ? <span className="text-xs text-neutral-400">includes {g.autoSelects.map((a) => PRODUCT_GROUPS[a].label).join(", ")}</span> : null}
              {isLocked && <span className="ml-auto text-xs text-neutral-400">auto-included</span>}
            </label>
          );
        })}
        <div className="pt-2">
          <PendingButton className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700" pendingLabel="Saving…">
            Save &amp; continue →
          </PendingButton>
        </div>
      </form>
    </section>
  );
}

// ─── Step 3: Stakeholders ────────────────────────────────────────────────────

async function StakeholdersStep({ c, stakeholders, nav }: { c: OnboardingCase; stakeholders: Stakeholder[]; nav: OnbNav }) {
  const companyId = c.hubspot_company_id;
  const [companyContacts, enrichment] = await Promise.all([
    companyId && hubspotEnabled() ? getCrm().listCompanyContacts(companyId, 100).catch(() => [] as ContactRecord[]) : Promise.resolve([] as ContactRecord[]),
    loadEnrichment(serviceClient(), c.id).catch(() => ({ snapshot: null, officers: [], ubos: [] })),
  ]);
  const byId = new Map<string, ContactRecord>(companyContacts.map((ct) => [ct.id, ct]));
  const missing = [...new Set(stakeholders.map((s) => s.hubspot_contact_id))].filter((cid) => !byId.has(cid));
  if (missing.length) {
    const extra = await Promise.all(missing.map((cid) => hubspotRepo.getContact(cid).catch(() => null)));
    for (const ct of extra) if (ct) byId.set(ct.id, ct);
  }
  const contactByName = new Map<string, ContactRecord>();
  for (const ct of companyContacts) {
    const pn = ct.first_name || ct.last_name ? { first: ct.first_name ?? "", last: ct.last_name ?? "" } : parsePersonName(ct.full_name);
    contactByName.set(nameMatchKey(pn.first, pn.last), ct);
  }
  const matchFor = (raw: string | null) => {
    const pn = parsePersonName(raw);
    return contactByName.get(nameMatchKey(pn.first, pn.last)) ?? null;
  };
  const roleLabel = (r: string) => ONBOARDING_ROLES.find((x) => x.key === r)?.label ?? r;

  const directors = enrichment.officers.filter((o) => /director/i.test(o.officer_role ?? "") && !o.resigned_on);
  const ubos = distinctIndividualUbos(enrichment.ubos);
  const enriched = !!enrichment.snapshot || enrichment.officers.length > 0 || enrichment.ubos.length > 0;

  const byContact = new Map<string, { contact: ContactRecord | undefined; roles: Stakeholder[] }>();
  for (const s of stakeholders) {
    const g = byContact.get(s.hubspot_contact_id) ?? { contact: byId.get(s.hubspot_contact_id), roles: [] };
    g.roles.push(s);
    byContact.set(s.hubspot_contact_id, g);
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Stakeholders &amp; roles</h2>
        <Link href={nav.stepHref("finish")} className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">Go to Submit for Approval →</Link>
      </div>
      <p className="text-sm text-neutral-500">Confirm the people behind this company: directors and beneficial owners from Companies House, then tag each contact with their role(s).</p>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-800">Directors &amp; UBOs <span className="font-normal text-neutral-400">(Companies House)</span></h3>
          <form action={pullOfficersUbosAction}>
            <input type="hidden" name="case_id" value={c.id} />
            <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Pulling…">
              {enriched ? "↻ Refresh from Companies House" : "Pull from Companies House"}
            </PendingButton>
          </form>
        </div>
        {!enriched ? (
          <p className="text-sm text-neutral-500">Pull active directors and beneficial owners (PSCs, with corporate ownership chains resolved) from Companies House, then match them to contacts or add the missing ones.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Active directors ({directors.length})</p>
              {directors.length === 0 ? <p className="text-xs text-neutral-400">No active directors found.</p> : (
                <ul className="space-y-1.5">
                  {directors.map((o) => <PersonRow key={o.id} caseId={c.id} rawName={o.name} subtitle={o.occupation} match={matchFor(o.name)} jobTitle={o.occupation || "Director"} />)}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Beneficial owners / PSCs ({ubos.length})</p>
              {ubos.length === 0 ? <p className="text-xs text-neutral-400">No individual beneficial owners found.</p> : (
                <ul className="space-y-1.5">
                  {ubos.map((u) => {
                    const sub = [(u.natures_of_control ?? []).join(", "), u.depth > 0 && u.via_company_number ? `via ${u.via_company_number}` : ""].filter(Boolean).join(" · ");
                    return <PersonRow key={u.id} caseId={c.id} rawName={u.name} subtitle={sub} match={matchFor(u.name)} jobTitle="Beneficial owner" />;
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Assigned roles</p>
        {stakeholders.length === 0 ? (
          <p className="text-sm text-neutral-400">No roles assigned yet.</p>
        ) : (
          <ul className="space-y-2">
            {[...byContact.values()].map((g) => {
              const key = g.roles[0]!.hubspot_contact_id;
              return (
                <li key={key} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2.5 text-sm">
                  <span className="font-medium text-neutral-800">{g.contact?.full_name || key}</span>
                  {g.contact?.job_title && <span className="text-xs text-neutral-400">{g.contact.job_title}</span>}
                  <span className="ml-auto flex flex-wrap gap-1">
                    {g.roles.map((s) => (
                      <form key={s.id} action={removeStakeholderAction} className="inline">
                        <input type="hidden" name="case_id" value={c.id} />
                        <input type="hidden" name="stakeholder_id" value={s.id} />
                        <button type="submit" className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200" title="Remove this role">{roleLabel(s.role)} ✕</button>
                      </form>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {companyContacts.length === 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No contacts on this company in HubSpot yet — add one below (or in HubSpot), then assign roles.
        </p>
      ) : (
        <AssignRoleForm
          caseId={c.id}
          contacts={companyContacts.filter((ct) => !byContact.has(ct.id)).map((ct) => ({ id: ct.id, name: ct.full_name || ct.id, title: ct.job_title ?? undefined }))}
          roles={ONBOARDING_ROLES.map((r) => ({ key: r.key, label: r.label }))}
          action={addStakeholderAction}
        />
      )}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">New contact</p>
        <form action={addContactToCompanyAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-3">
          <input type="hidden" name="case_id" value={c.id} />
          <div><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">First name</label><input name="first_name" className={field} placeholder="Jane" /></div>
          <div><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">Last name</label><input name="last_name" className={field} placeholder="Smith" /></div>
          <div className="min-w-48 flex-1"><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">Email</label><input name="email" type="email" className={field} placeholder="jane@company.com" /></div>
          <div><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">Job title</label><input name="job_title" className={field} placeholder="CFO" /></div>
          <div><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">Mobile</label><input name="mobile" type="tel" className={field} placeholder="07…" /></div>
          <div className="min-w-48 flex-1"><label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">LinkedIn</label><input name="linkedin" type="url" className={field} placeholder="linkedin.com/in/…" /></div>
          <PendingButton className="rounded border border-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50" pendingLabel="Adding…">+ New contact</PendingButton>
        </form>
        <p className="mt-1 text-xs text-neutral-400">Creates the contact on the company (and links it to this deal), then pick it above with a role.</p>
      </div>

      <div>
        <Link href={nav.stepHref("finish")} className="text-sm text-blue-700 hover:underline">Next: Submit for Approval →</Link>
      </div>
    </section>
  );
}

function PersonRow({ caseId, rawName, subtitle, match, jobTitle }: {
  caseId: string; rawName: string | null; subtitle?: string | null; match: ContactRecord | null; jobTitle: string;
}) {
  const pn = parsePersonName(rawName);
  const display = [pn.first, pn.last].filter(Boolean).join(" ") || rawName || "—";
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm">
      <span className="font-medium text-neutral-800">{display}</span>
      {subtitle && <span className="text-xs text-neutral-400">{subtitle}</span>}
      {match ? (
        <span className="ml-auto flex items-center gap-1 text-xs">
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">✓ in system</span>
          <Link href={`/contacts/${match.id}`} className="text-blue-700 hover:underline">{match.full_name || match.email}</Link>
        </span>
      ) : (
        <form action={addContactToCompanyAction} className="ml-auto">
          <input type="hidden" name="case_id" value={caseId} />
          <input type="hidden" name="first_name" value={pn.first} />
          <input type="hidden" name="last_name" value={pn.last} />
          <input type="hidden" name="job_title" value={jobTitle} />
          <PendingButton className="rounded border border-emerald-500 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" pendingLabel="Adding…">+ Add to HubSpot</PendingButton>
        </form>
      )}
    </li>
  );
}

// ─── Step 4: Submit for Approval ─────────────────────────────────────────────

async function FinishStep({ c, stakeholders, locked, generatedDocs, nav }: {
  c: OnboardingCase; stakeholders: Stakeholder[]; locked: boolean; generatedDocs: GeneratedDoc[]; nav: OnbNav;
}) {
  const groups = c.product_groups;
  const ready = readyToComplete(c, stakeholders.length);
  const weight = isLightTouch(groups) ? "light-touch" : requiresFullKyc(groups) ? "full KYC" : "—";
  const checks: string[] = [];
  if (requiresTuSection(groups)) checks.push("TU due-diligence + infosec");
  if (requiresPayments(groups)) checks.push("Payment / disbursal details");
  if (requiresDirectDebit(groups)) checks.push("Direct Debit sub-form");
  if (requiresFcaFrn(groups)) checks.push("FCA FRN (required)");
  if (requiresFullKyc(groups)) checks.push("UBO chain + ID&V + PEP");
  const docs = documentsFor(groups);
  const events = await listCaseEvents(serviceClient(), c.id);
  const formLink = merchantFormUrl(c.merchant_form_token);
  // The DD (customer form) is complete once the merchant has submitted — that's
  // when "Submit for Approval" becomes active (item 4b).
  const ddComplete = ["merchant_submitted", "ubo_checks", "docs_generated", "awaiting_approval", "onboarded"].includes(c.status);

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h2 className="mb-1 font-semibold">Review &amp; submit for approval</h2>
        <p className="text-sm text-neutral-500">What the selection implies downstream:</p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Summary label="Company">{c.company_number ?? <span className="text-neutral-400">not set</span>}</Summary>
        <Summary label="Path">{weight}</Summary>
        <Summary label="Product groups">{groups.length ? groups.map((g) => PRODUCT_GROUPS[g as keyof typeof PRODUCT_GROUPS]?.label ?? g).join(", ") : <span className="text-neutral-400">none</span>}</Summary>
        <Summary label="Stakeholders">{stakeholders.length}</Summary>
        <Summary label="Checks triggered">{checks.length ? checks.join(" · ") : <span className="text-neutral-400">basic CH check only</span>}</Summary>
        <Summary label="Documents">{docs.length ? docs.map((d) => DOC_LABELS[d]).join(", ") : <span className="text-neutral-400">none</span>}</Summary>
      </dl>

      {c.status === "started" ? (
        <form action={completeInternalAction} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <input type="hidden" name="case_id" value={c.id} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="api_sandbox_required" defaultChecked={c.api_sandbox_required} className="h-4 w-4" />
            <span className="font-medium text-neutral-800">API sandbox access required</span>
          </label>
          <p className="text-xs text-neutral-500">Completing generates the onboarding document pack and creates the customer onboarding link (no email is sent — you share the link). If sandbox is ticked, it also files an internal sandbox request.</p>
          <PendingButton className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50" pendingLabel="Completing…" disabled={!ready}>
            ✓ Complete internal onboarding &amp; create customer link
          </PendingButton>
          {!ready && <p className="text-xs text-neutral-500">Finish the company, products and stakeholders steps first.</p>}
        </form>
      ) : (
        <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-neutral-800">Customer onboarding link</h3>
            <StatusBadge status={c.status} />
          </div>
          {c.status === "onboarded" ? (
            <p className="text-sm text-emerald-800">✓ <strong>Approved &amp; onboarded.</strong> The customer has confirmed and the case has been signed off.</p>
          ) : (
            <>
              <p className="text-sm text-neutral-500">Send this secure link to the customer so they can complete their onboarding form (product-specific to this deal). No email is sent automatically — share it yourself.</p>
              <div className="flex items-start gap-2 rounded border border-dashed border-neutral-300 bg-neutral-50 p-2">
                <a href={formLink} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-blue-700 hover:underline">{formLink}</a>
                <CopyButton text={formLink} label="Copy link" />
              </div>
            </>
          )}
          {/* Submit for Approval → the review/approve screen. Active once the
              customer's DD form is complete (item 4). */}
          {ddComplete ? (
            <Link href={nav.reviewHref} className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Submit for Approval →</Link>
          ) : c.status !== "onboarded" ? (
            <div>
              <button type="button" disabled className="cursor-not-allowed rounded bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-400">Submit for Approval →</button>
              <p className="mt-1 text-xs text-neutral-500">Available once the customer completes their onboarding form.</p>
            </div>
          ) : (
            <Link href={nav.reviewHref} className="inline-block text-sm text-blue-700 hover:underline">View submission →</Link>
          )}
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="mb-1 font-semibold text-neutral-800">Supporting documents</h3>
        {generatedDocs.length === 0 ? (
          <p className="text-sm text-neutral-500">No documents generated yet — they&apos;re produced when you complete internal onboarding, and refreshed when the customer submits.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {generatedDocs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="text-neutral-800">📄 {d.filename}</span>
                <span className="text-xs text-neutral-400">{DOC_LABELS[d.doc_kind as OnboardingDocKind] ?? d.doc_kind}</span>
                <span className="text-xs text-neutral-400">· {fmtDate(d.generated_at)}</span>
                <a href={nav.docHref(d.id)} className="ml-auto text-blue-700 hover:underline">Download ↓</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="mb-2 font-semibold text-neutral-800">Case history</h3>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">No activity logged yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                <span className="w-32 shrink-0 text-xs text-neutral-400">{fmtDate(e.created_at)}</span>
                <span className="font-medium text-neutral-700">{humanEvent(e.event)}</span>
                {e.actor_email && <span className="text-xs text-neutral-400">by {e.actor_email}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Delete & restart (item 5): archive this case so a fresh one can be
          started. Reversible — the data is kept, the case is just cancelled. */}
      <form action={cancelCaseAction} className="pt-2">
        <input type="hidden" name="case_id" value={c.id} />
        <ConfirmSubmit
          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          message="Delete this onboarding? It will be archived (the data is kept) and you can start a fresh onboarding for this company."
        >
          Delete &amp; restart onboarding
        </ConfirmSubmit>
      </form>
    </section>
  );
}

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{children}</dd>
    </div>
  );
}

// ─── Review / approve panel ──────────────────────────────────────────────────

function kb(n: number | null): string {
  if (!n) return "";
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}
function copBadge(r: string | null) {
  const cls = r === "match" ? "bg-emerald-100 text-emerald-800" : r === "close_match" ? "bg-amber-100 text-amber-800" : r === "no_match" ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>CoP: {r ? r.replace(/_/g, " ") : "—"}</span>;
}

export async function OnboardingReviewPanel({ caseId, nav }: { caseId: string; nav: OnbNav }) {
  const db = serviceClient();
  const c = await getCase(db, caseId);
  if (!c) return <p className="text-sm text-neutral-500">Onboarding case not found.</p>;

  const [{ form, kyc, bankAccounts, directDebit }, privacy, uploads, uboChecks, generatedDocs, uboRequests, uboDocs] = await Promise.all([
    loadMerchantForm(db, caseId),
    loadPrivacyAssessment(db, caseId),
    loadUploads(db, caseId),
    loadUboChecks(db, caseId),
    loadGeneratedDocs(db, caseId),
    loadUboDocRequests(db, caseId),
    loadUboDocs(db, caseId),
  ]);
  const driveUrl = await caseDriveFolderUrl(db, caseId);

  const b = form?.business ?? {};
  const comp = form?.compliance ?? {};
  const sig = form?.signatory ?? {};
  const pr = privacy?.result ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={nav.caseHref} className="text-sm text-blue-700 hover:underline">← Case</Link>
      </div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h2 className="text-lg font-semibold">Merchant submission</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {c.company_number ? `Company ${c.company_number}` : "—"} · status {c.status.replace(/_/g, " ")}
            {form?.submitted_at && ` · submitted ${fmtDateTime(form.submitted_at)}`}
          </p>
        </div>
        {c.status === "onboarded" ? (
          <span className="rounded bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800">✓ Onboarded</span>
        ) : (
          <form action={approveCaseAction}>
            <input type="hidden" name="case_id" value={caseId} />
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
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Documents</h3>
              <form action={generateDocsAction}>
                <input type="hidden" name="case_id" value={caseId} />
                <PendingButton className="rounded bg-[#003566] px-3 py-1 text-xs font-medium text-white hover:bg-[#002a52]" pendingLabel="Generating…">
                  {generatedDocs.length ? "Regenerate" : "✨ Generate documents"}
                </PendingButton>
              </form>
              {generatedDocs.length > 0 && (
                <form action={fileToDriveAction}>
                  <input type="hidden" name="case_id" value={caseId} />
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
                    <a href={nav.docHref(d.id)} className="font-medium text-blue-700 hover:underline">⬇ {d.filename}</a>
                    <span className="text-xs text-neutral-400">{fmtDateTime(d.generated_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

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

          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Beneficial owners ({kyc.length})</h3>
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

          <section>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Identity &amp; screening</h3>
              <form action={runUboChecksAction}>
                <input type="hidden" name="case_id" value={caseId} />
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
                    {(() => {
                      const failed = !ch.idv_verified || ch.pep_match || ch.sanctions_match;
                      const reqRow = ch.ubo_name ? uboRequests.get(ch.ubo_name) : undefined;
                      const docs = uboDocs.filter((d) => d.ubo_ref === ch.ubo_name);
                      if (!failed && !reqRow && docs.length === 0) return null;
                      return (
                        <div className="mt-2 border-t border-neutral-100 pt-2">
                          {reqRow ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-neutral-600">Document-upload link:</span>
                              <a href={uboUploadUrl(reqRow.token)} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 hover:underline">{uboUploadUrl(reqRow.token)}</a>
                              <CopyButton text={uboUploadUrl(reqRow.token)} label="Copy" />
                              <span className="text-neutral-400">— send to this owner to upload a passport + proof of address.</span>
                            </div>
                          ) : failed ? (
                            <form action={requestUboDocsAction}>
                              <input type="hidden" name="case_id" value={caseId} />
                              <input type="hidden" name="ubo_name" value={ch.ubo_name ?? ""} />
                              <PendingButton className="rounded border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-50" pendingLabel="…">Request documents →</PendingButton>
                            </form>
                          ) : null}
                          {docs.length > 0 && (
                            <ul className="mt-1 text-xs text-neutral-600">
                              {docs.map((d) => <li key={d.id}>📎 {d.kind === "ubo_passport" ? "Passport" : "Proof of address"}: {d.filename}</li>)}
                            </ul>
                          )}
                        </div>
                      );
                    })()}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(bankAccounts.length > 0 || directDebit) && (
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Payments</h3>
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

          <section>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Privacy-policy assessment</h3>
              <form action={assessPrivacyPolicyAction}>
                <input type="hidden" name="case_id" value={caseId} />
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

          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Infosec documents ({uploads.length})</h3>
            {uploads.length === 0 ? <p className="text-sm text-neutral-400">None uploaded.</p> : (
              <ul className="space-y-2">
                {uploads.map((u) => (
                  <li key={u.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">{u.filename}</span>
                      <span className="text-xs text-neutral-400">{kb(u.size_bytes)} · {fmtDate(u.created_at)}</span>
                      <form action={extractUploadAction} className="ml-auto">
                        <input type="hidden" name="case_id" value={caseId} />
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
                        {u.extracted.executive_summary && <p className="mt-1 rounded bg-neutral-50 p-1.5 text-neutral-700"><span className="font-medium">Exec summary:</span> {u.extracted.executive_summary}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
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

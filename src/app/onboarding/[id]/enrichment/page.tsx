// Phase 2 — Companies House enrichment view for a case. Shows the stored
// snapshot (company + risk flags), officers (current + resigned ≤12mo) and the
// PSC/UBO chain, with an Enrich / Re-enrich button. Deep accounts (iXBRL
// financial figures) are a later sub-step (P2b).

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { getCase } from "@/lib/onboarding/cases";
import { loadEnrichment, type UboRow } from "@/lib/onboarding/enrich";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { enrichCaseAction } from "../../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pretty = (s: string) => s.replace(/-/g, " ");
const dob = (m: number | null, y: number | null) => (m || y ? `${m ?? "?"}/${y ?? "?"}` : "—");

function addressLine(a: Record<string, string | undefined> | null): string {
  if (!a) return "—";
  return [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
}

function Flag({ on, label, warn = true }: { on: boolean; label: string; warn?: boolean }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${on ? (warn ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800") : "bg-emerald-100 text-emerald-800"}`}>
      {label}: {on ? "yes" : "no"}
    </span>
  );
}

export default async function EnrichmentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) notFound();
  const { snapshot, officers, ubos } = await loadEnrichment(db, id);

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href={`/onboarding/${id}`} className="text-sm text-blue-700 hover:underline">← Case</Link>

      <header className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Companies House enrichment</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {c.company_number ? `Company ${c.company_number}` : "No company confirmed"}
            {snapshot?.enriched_at && ` · enriched ${fmtDateTime(snapshot.enriched_at)}`}
          </p>
        </div>
        {c.company_number ? (
          <form action={enrichCaseAction}>
            <input type="hidden" name="case_id" value={id} />
            <PendingButton className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800" pendingLabel="Pulling from Companies House…">
              {snapshot ? "Re-enrich" : "✨ Enrich"}
            </PendingButton>
          </form>
        ) : (
          <Link href={`/onboarding/${id}?step=company`} className="rounded border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">Confirm company first →</Link>
        )}
      </header>

      {!snapshot ? (
        <p className="text-neutral-500">
          {c.company_number
            ? "Not enriched yet — hit Enrich to pull officers, PSCs/UBOs, charges and insolvency from Companies House."
            : "Confirm the company on step 1 first."}
        </p>
      ) : (
        <div className="space-y-6">
          {/* Risk flags */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Risk flags</h2>
            <div className="flex flex-wrap gap-2">
              <Flag on={snapshot.accounts_overdue} label="Accounts overdue" />
              <Flag on={snapshot.confirmation_statement_overdue} label="Conf. stmt overdue" />
              <Flag on={snapshot.has_charges} label="Charges" warn={false} />
              <Flag on={snapshot.has_insolvency_history} label="Insolvency history" />
              <Flag on={snapshot.disqualified_officer_found} label="Disqualified-officer match" />
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${snapshot.company_status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                Status: {snapshot.company_status ?? "—"}
              </span>
            </div>
            {snapshot.disqualified_officer_found && (
              <p className="mt-2 text-xs text-red-700">⚠ A kept officer name matched the disqualified-officers register. This is a name match only — verify manually before relying on it.</p>
            )}
          </section>

          {/* Company */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Cell label="Name">{snapshot.company_name ?? "—"}</Cell>
            <Cell label="Type">{snapshot.company_type ?? "—"}</Cell>
            <Cell label="Incorporated">{snapshot.incorporation_date ? fmtDate(snapshot.incorporation_date) : "—"}</Cell>
            <Cell label="SIC codes">{snapshot.sic_codes.length ? snapshot.sic_codes.join(", ") : "—"}</Cell>
            <Cell label="Accounts next due">{snapshot.accounts_next_due ? fmtDate(snapshot.accounts_next_due) : "—"}</Cell>
            <Cell label="Conf. statement due">{snapshot.confirmation_statement_next_due ? fmtDate(snapshot.confirmation_statement_next_due) : "—"}</Cell>
            <Cell label="Registered office" wide>{addressLine(snapshot.registered_office)}</Cell>
          </section>

          {/* Officers */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Officers ({officers.length}) · current + resigned ≤12mo</h2>
            {officers.length === 0 ? <p className="text-sm text-neutral-400">None.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase text-neutral-400">
                  <tr><th className="py-1">Name</th><th>Role</th><th>Appointed</th><th>Resigned</th><th>DOB</th><th>Nat.</th></tr>
                </thead>
                <tbody>
                  {officers.map((o) => (
                    <tr key={o.id} className={`border-t border-neutral-100 ${o.resigned_on ? "text-neutral-400" : ""}`}>
                      <td className="py-1.5 font-medium text-neutral-800">
                        {o.name}
                        {o.is_disqualified && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">disq?</span>}
                      </td>
                      <td>{o.officer_role ?? "—"}</td>
                      <td>{o.appointed_on ? fmtDate(o.appointed_on) : "—"}</td>
                      <td>{o.resigned_on ? fmtDate(o.resigned_on) : <span className="text-emerald-700">current</span>}</td>
                      <td>{dob(o.dob_month, o.dob_year)}</td>
                      <td>{o.nationality ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          {/* UBO chain */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">PSC / UBO chain ({ubos.length})</h2>
            {ubos.length === 0 ? <p className="text-sm text-neutral-400">No persons with significant control reported.</p> : (
              <ul className="space-y-1.5">
                {ubos.map((u) => <UboNode key={u.id} u={u} />)}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function UboNode({ u }: { u: UboRow }) {
  const reg = u.identification?.registration_number ? String(u.identification.registration_number) : null;
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-2.5 text-sm" style={{ marginLeft: `${Math.min(u.depth, 3) * 20}px` }}>
      <div className="flex flex-wrap items-center gap-2">
        {u.depth > 0 && <span className="text-neutral-300">↳</span>}
        <span className="font-medium text-neutral-800">{u.name ?? "(unnamed PSC)"}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${u.is_corporate ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-500"}`}>
          {u.is_corporate ? "corporate" : u.kind?.includes("statement") ? "statement" : "individual"}
        </span>
        {reg && <span className="text-xs text-neutral-400">reg {reg}</span>}
        {u.depth > 0 && u.via_company_number && <span className="text-xs text-neutral-400">via {u.via_company_number}</span>}
      </div>
      {u.natures_of_control.length > 0 && (
        <div className="mt-1 text-xs text-neutral-500">{u.natures_of_control.map(pretty).join(" · ")}</div>
      )}
    </li>
  );
}

function Cell({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-neutral-200 bg-white p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 text-sm text-neutral-800">{children}</div>
    </div>
  );
}

"use client";

// Client-interactive company-page fields for the merchant form:
//  • TradingAddress   — "same as registered" toggle + Postcoder postcode lookup
//  • TradeBody        — Yes/No, with the "which?" field shown only on Yes (6d)
//  • SignatoryPicker  — choose an existing contact or add a new one (6e); a new
//                       one is created in HubSpot on submit
//  • DpoList          — one DPO by default; each row can pick an existing contact
//                       or add a new one (added to HubSpot on submit) (6f)
// All degrade to plain typing when JS/lookup is unavailable.

import { useState } from "react";

const field = "w-full rounded-md border border-neutral-300 px-3 py-2.5 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const lbl = "block text-sm font-medium text-neutral-800 mb-1";
// Phone format: "{country code} {number}", e.g. +44 7590571361 (6b). Kept inline
// (not imported from fields.ts) so no server-only code leaks into this client bundle.
const PHONE = { inputMode: "tel" as const, pattern: "\\+\\d{1,3} \\d[\\d ]{5,15}", title: "Use the international format: country code, a space, then the number — e.g. +44 7590571361", placeholder: "+44 7590571361" };

interface Addr { summaryline: string; line1: string; line2: string; city: string; county: string; postcode: string }

// ─── Trading address ─────────────────────────────────────────────────────────

export function TradingAddress({ registered, defaultAddress }: { registered: string; defaultAddress: string }) {
  const hasReg = registered.trim().length > 0;
  // Default to "same as registered" when we have a registered address and the
  // trading address is empty or already equals it.
  const [same, setSame] = useState(hasReg && (!defaultAddress.trim() || defaultAddress.trim() === registered.trim()));
  const [addr, setAddr] = useState(defaultAddress);
  const [postcode, setPostcode] = useState("");
  const [results, setResults] = useState<Addr[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(defaultAddress.trim().length > 0);

  async function find() {
    if (!postcode.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/m/address?postcode=${encodeURIComponent(postcode.trim())}`);
      const list = res.ok ? ((await res.json()) as { addresses?: Addr[] }).addresses ?? [] : [];
      setResults(list);
      if (list.length === 0) setManual(true); // nothing found → let them type it
    } catch { setResults([]); setManual(true); }
    setLoading(false);
  }

  return (
    <div className="sm:col-span-2">
      <span className={lbl}>Trading address <span className="text-red-600">*</span></span>
      {hasReg && (
        <label className="mb-2 flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> Same as registered address
        </label>
      )}
      {same ? (
        <>
          <input type="hidden" name="trading_address" value={registered} />
          <input type="hidden" name="trading_same_as_registered" value="1" />
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">{registered}</p>
        </>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-neutral-500">Find by postcode</label>
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. E14 5AB" className={field} />
            </div>
            <button type="button" onClick={find} disabled={loading} className="rounded-md border border-[#003566] px-3 py-2.5 text-sm font-medium text-[#003566] hover:bg-[#003566]/5 disabled:opacity-50">
              {loading ? "Finding…" : "Find address"}
            </button>
          </div>
          {results.length > 0 && (
            <select onChange={(e) => { const a = results[Number(e.target.value)]; if (a) { setAddr(a.summaryline); setManual(true); } }} defaultValue="" className={`${field} mb-2`}>
              <option value="" disabled>Select your address…</option>
              {results.map((a, i) => <option key={i} value={i}>{a.summaryline}</option>)}
            </select>
          )}
          {!manual ? (
            <button type="button" onClick={() => setManual(true)} className="text-xs font-medium text-[#003566] underline">Enter the address manually</button>
          ) : (
            <textarea name="trading_address" required rows={3} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Street, town, postcode" className={field} />
          )}
        </>
      )}
    </div>
  );
}

// ─── Trade body (6d) ─────────────────────────────────────────────────────────

export function TradeBody({ requiredDefault, bodyDefault }: { requiredDefault: string; bodyDefault: string }) {
  const [val, setVal] = useState(requiredDefault);
  return (
    <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-[#003566]">Trade body</legend>
      <span className={lbl}>Are you required to be part of a trade body? <span className="text-red-600">*</span></span>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" name="trade_body_required" value="yes" checked={val === "yes"} onChange={() => setVal("yes")} /> Yes</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="trade_body_required" value="no" checked={val === "no"} onChange={() => setVal("no")} /> No</label>
      </div>
      {val === "yes" && (
        <div className="mt-3">
          <label htmlFor="trade_body" className={lbl}>Which trade body?</label>
          <input id="trade_body" name="trade_body" defaultValue={bodyDefault} className={field} />
        </div>
      )}
    </fieldset>
  );
}

// ─── Authorised signatory (6e) ───────────────────────────────────────────────

interface ContactOpt { id: string; name: string; email: string; title: string }

export function SignatoryPicker({ contacts, prefill, defaults }: {
  contacts: ContactOpt[]; prefill: { name: string; email: string; title: string } | null;
  defaults: { name: string; title: string; email: string };
}) {
  const hasContacts = contacts.length > 0;
  const start = prefill ?? (defaults.name || defaults.email ? { name: defaults.name, email: defaults.email, title: defaults.title } : null);
  const [mode, setMode] = useState<"existing" | "new">(hasContacts ? "existing" : "new");
  const [name, setName] = useState(start?.name ?? "");
  const [title, setTitle] = useState(start?.title ?? defaults.title ?? "");
  const [email, setEmail] = useState(start?.email ?? "");

  function pick(id: string) {
    const ct = contacts.find((c) => c.id === id);
    if (ct) { setName(ct.name); setTitle(ct.title); setEmail(ct.email); }
  }

  return (
    <fieldset className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-[#003566]">Authorised signatory</legend>
      {hasContacts && (
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-1.5"><input type="radio" name="__sig_mode" checked={mode === "existing"} onChange={() => setMode("existing")} /> Select an existing contact</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="__sig_mode" checked={mode === "new"} onChange={() => setMode("new")} /> Add a new contact</label>
        </div>
      )}
      {hasContacts && mode === "existing" && (
        <div className="sm:col-span-2">
          <label className={lbl}>Choose a contact</label>
          <select defaultValue="" onChange={(e) => pick(e.target.value)} className={field}>
            <option value="" disabled>Choose…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` - ${c.title}` : ""}</option>)}
          </select>
        </div>
      )}
      {mode === "new" && <p className="text-xs text-neutral-500 sm:col-span-2">We&apos;ll add this person to HubSpot as a contact automatically.</p>}
      <div>
        <label htmlFor="signatory_name" className={lbl}>Full name <span className="text-red-600">*</span></label>
        <input id="signatory_name" name="signatory_name" required value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="signatory_title" className={lbl}>Title / role <span className="text-red-600">*</span></label>
        <input id="signatory_title" name="signatory_title" required value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="signatory_email" className={lbl}>Email <span className="text-red-600">*</span></label>
        <input id="signatory_email" name="signatory_email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      </div>
    </fieldset>
  );
}

// ─── Data protection officers (6f) ───────────────────────────────────────────

interface DpoRow { first: string; last: string; title: string; email: string; phone: string }
export interface DpoContact { id: string; first: string; last: string; title: string; email: string; phone: string }
const BLANK: DpoRow = { first: "", last: "", title: "", email: "", phone: "" };
const DPO_COLS: { key: keyof DpoRow; label: string; type?: string }[] = [
  { key: "first", label: "First name" }, { key: "last", label: "Last name" },
  { key: "title", label: "Job title" }, { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
];

export function DpoList({ initial, prefill, contacts }: { initial: DpoRow[]; prefill: DpoRow | null; contacts: DpoContact[] }) {
  const seed: DpoRow[] = initial.length > 0 ? initial : [prefill ?? BLANK];
  const [rows, setRows] = useState<DpoRow[]>(seed);

  const update = (i: number, key: keyof DpoRow, val: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));

  function pick(i: number, id: string) {
    if (id === "__new__") { setRows((rs) => rs.map((r, j) => (j === i ? { ...BLANK } : r))); return; }
    const ct = contacts.find((c) => c.id === id);
    if (ct) setRows((rs) => rs.map((r, j) => (j === i ? { first: ct.first, last: ct.last, title: ct.title, email: ct.email, phone: ct.phone } : r)));
  }

  return (
    <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-[#003566]">Data protection officer(s) <span className="text-red-600">*</span></legend>
      <input type="hidden" name="dpo_count" value={rows.length} />
      <div className="mt-2 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded border border-neutral-200 p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Officer {i + 1}</p>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-[11px] text-neutral-400 hover:text-red-600">Remove</button>
              )}
            </div>
            {contacts.length > 0 && (
              <div className="mb-3">
                <label htmlFor={`__dpo_pick_${i}`} className={lbl}>Select an existing contact, or add a new one</label>
                <select id={`__dpo_pick_${i}`} defaultValue="" onChange={(e) => pick(i, e.target.value)} className={field}>
                  <option value="" disabled>Choose…</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{[c.first, c.last].filter(Boolean).join(" ") || c.email}{c.title ? ` - ${c.title}` : ""}</option>)}
                  <option value="__new__">Add a new contact</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DPO_COLS.map((d) => (
                <div key={d.key}>
                  <label htmlFor={`dpo_${i}_${d.key}`} className={lbl}>{d.label}</label>
                  <input
                    id={`dpo_${i}_${d.key}`} name={`dpo_${i}_${d.key}`} type={d.type ?? "text"}
                    {...(d.type === "tel" ? PHONE : {})}
                    value={row[d.key]} onChange={(e) => update(i, d.key, e.target.value)} className={field}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((rs) => [...rs, { ...BLANK }])} className="mt-2 rounded-md border border-[#003566] px-3 py-1.5 text-sm font-medium text-[#003566] hover:bg-[#003566]/5">
        + Add another DPO
      </button>
      {contacts.length > 0 && <p className="mt-2 text-xs text-neutral-500">New officers (not picked from the list) are added to HubSpot automatically.</p>}
    </fieldset>
  );
}

"use client";

// Client-interactive company-page fields for the merchant form:
//  • TradingAddress   — "same as registered" toggle + Postcoder postcode lookup
//  • TradeBody        — Yes/No, with the "which?" field shown only on Yes
//  • SignatoryPicker  — EITHER pick an existing contact (dropdown only) OR add a
//                       new one (fields only) — never both (item 2)
//  • DpoList          — one DPO by default; each row is an existing contact, a
//                       new person, or a new company (items 2 & 3)
// All degrade to plain typing when JS/lookup is unavailable.

import { useState } from "react";

const field = "w-full rounded-md border border-neutral-300 px-3 py-2.5 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const lbl = "block text-sm font-medium text-neutral-800 mb-1";
// Phone: international (+44 7700 900123, space/hyphen optional) or UK local
// (07700 900123). Placeholder uses Ofcom's fictional range, not a real number.
const PHONE = { inputMode: "tel" as const, pattern: "(\\+\\d{1,3}[\\s-]?\\d[\\d\\s-]{5,15}|0\\d{2,4}[\\s-]?\\d[\\d\\s-]{4,10})", title: "Enter a valid phone number, e.g. +44 7700 900123 or 07700 900123", placeholder: "+44 7700 900123" };

interface Addr { summaryline: string; line1: string; line2: string; city: string; county: string; postcode: string }

// ─── Trading address ─────────────────────────────────────────────────────────

export function TradingAddress({ registered, defaultAddress }: { registered: string; defaultAddress: string }) {
  const hasReg = registered.trim().length > 0;
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
      if (list.length === 0) setManual(true);
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

// ─── Trade body ──────────────────────────────────────────────────────────────

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

// ─── Authorised signatory (items 2) ──────────────────────────────────────────

interface ContactOpt { id: string; name: string; email: string; title: string }

export function SignatoryPicker({ contacts, prefill, defaults }: {
  contacts: ContactOpt[]; prefill: { name: string; email: string; title: string } | null;
  defaults: { name: string; title: string; email: string };
}) {
  const hasContacts = contacts.length > 0;
  const start = prefill ?? (defaults.name || defaults.email ? { name: defaults.name, email: defaults.email, title: defaults.title } : null);
  // If a signatory is already known, pre-select the matching contact (existing)
  // or, if it isn't one of the company's contacts, start in "new" with it filled.
  const matchCt = start?.email ? contacts.find((c) => c.email && c.email.toLowerCase() === start.email.toLowerCase()) ?? null : null;
  const [mode, setMode] = useState<"existing" | "new">(matchCt ? "existing" : start ? "new" : hasContacts ? "existing" : "new");
  const [selId, setSelId] = useState(matchCt?.id ?? "");
  const [name, setName] = useState(start?.name ?? "");
  const [title, setTitle] = useState(start?.title ?? defaults.title ?? "");
  const [email, setEmail] = useState(start?.email ?? "");

  const selCt = contacts.find((c) => c.id === selId) ?? null;
  const subName = mode === "existing" ? (selCt?.name ?? "") : name;
  const subTitle = mode === "existing" ? (selCt?.title ?? "") : title;
  const subEmail = mode === "existing" ? (selCt?.email ?? "") : email;

  return (
    <fieldset className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-[#003566]">Authorised signatory</legend>
      {hasContacts && (
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-1.5"><input type="radio" name="__sig_mode" checked={mode === "existing"} onChange={() => setMode("existing")} /> Select an existing contact</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="__sig_mode" checked={mode === "new"} onChange={() => setMode("new")} /> Add a new contact</label>
        </div>
      )}
      {mode === "existing" && hasContacts ? (
        <div className="sm:col-span-2">
          <label className={lbl}>Choose a contact</label>
          <select value={selId} onChange={(e) => setSelId(e.target.value)} className={field}>
            <option value="" disabled>Choose…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` - ${c.title}` : ""}</option>)}
          </select>
          {selCt && <p className="mt-2 text-xs text-neutral-500">{[selCt.name, selCt.title, selCt.email].filter(Boolean).join(" · ")}</p>}
          <input type="hidden" name="signatory_name" value={subName} />
          <input type="hidden" name="signatory_title" value={subTitle} />
          <input type="hidden" name="signatory_email" value={subEmail} />
        </div>
      ) : (
        <>
          <p className="text-xs text-neutral-500 sm:col-span-2">We&apos;ll add this person to HubSpot as a contact automatically.</p>
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
        </>
      )}
    </fieldset>
  );
}

// ─── Data protection officers (items 2 & 3) ──────────────────────────────────

export interface DpoRowData { kind: "person" | "company"; company: string; first: string; last: string; title: string; email: string; phone: string }
export interface DpoContact { id: string; first: string; last: string; title: string; email: string; phone: string }
type Choice = "existing" | "person" | "company";
interface Row extends DpoRowData { choice: Choice }
const BLANK: DpoRowData = { kind: "person", company: "", first: "", last: "", title: "", email: "", phone: "" };

export function DpoList({ initial, prefill, contacts }: { initial: DpoRowData[]; prefill: DpoRowData | null; contacts: DpoContact[] }) {
  const hasContacts = contacts.length > 0;
  const toRow = (d: DpoRowData): Row => ({ ...d, choice: d.kind === "company" ? "company" : "person" });
  const seed: Row[] = initial.length > 0 ? initial.map(toRow) : [toRow(prefill ?? BLANK)];
  const [rows, setRows] = useState<Row[]>(seed);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...BLANK, choice: hasContacts ? "existing" : "person" }]);
  const pick = (i: number, id: string) => {
    const ct = contacts.find((c) => c.id === id);
    if (ct) set(i, { first: ct.first, last: ct.last, title: ct.title, email: ct.email, phone: ct.phone, kind: "person", company: "" });
  };

  return (
    <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-[#003566]">Data protection officer(s) <span className="text-red-600">*</span></legend>
      <input type="hidden" name="dpo_count" value={rows.length} />
      <div className="mt-2 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded border border-neutral-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Officer {i + 1}</p>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-[11px] text-neutral-400 hover:text-red-600">Remove</button>
              )}
            </div>

            {/* kind (person vs company) is submitted; "existing" is a person. */}
            <input type="hidden" name={`dpo_${i}_kind`} value={row.choice === "company" ? "company" : "person"} />

            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {hasContacts && <label className="flex items-center gap-1.5"><input type="radio" name={`__dpo_choice_${i}`} checked={row.choice === "existing"} onChange={() => set(i, { choice: "existing" })} /> Existing contact</label>}
              <label className="flex items-center gap-1.5"><input type="radio" name={`__dpo_choice_${i}`} checked={row.choice === "person"} onChange={() => set(i, { choice: "person" })} /> Add a person</label>
              <label className="flex items-center gap-1.5"><input type="radio" name={`__dpo_choice_${i}`} checked={row.choice === "company"} onChange={() => set(i, { choice: "company" })} /> Add a company</label>
            </div>

            {row.choice === "existing" ? (
              <div>
                <label htmlFor={`__dpo_pick_${i}`} className={lbl}>Choose a contact</label>
                <select id={`__dpo_pick_${i}`} defaultValue="" onChange={(e) => pick(i, e.target.value)} className={field}>
                  <option value="" disabled>Choose…</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{[c.first, c.last].filter(Boolean).join(" ") || c.email}{c.title ? ` - ${c.title}` : ""}</option>)}
                </select>
                {(row.first || row.last || row.email) && <p className="mt-2 text-xs text-neutral-500">{[[row.first, row.last].filter(Boolean).join(" "), row.title, row.email].filter(Boolean).join(" · ")}</p>}
                {/* submitted (filled from the picked contact) */}
                <input type="hidden" name={`dpo_${i}_first`} value={row.first} />
                <input type="hidden" name={`dpo_${i}_last`} value={row.last} />
                <input type="hidden" name={`dpo_${i}_title`} value={row.title} />
                <input type="hidden" name={`dpo_${i}_email`} value={row.email} />
                <input type="hidden" name={`dpo_${i}_phone`} value={row.phone} />
                <input type="hidden" name={`dpo_${i}_company`} value="" />
              </div>
            ) : row.choice === "company" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor={`dpo_${i}_company`} className={lbl}>Company name</label>
                  <input id={`dpo_${i}_company`} name={`dpo_${i}_company`} value={row.company} onChange={(e) => set(i, { company: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor={`dpo_${i}_email`} className={lbl}>Email</label>
                  <input id={`dpo_${i}_email`} name={`dpo_${i}_email`} type="email" value={row.email} onChange={(e) => set(i, { email: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor={`dpo_${i}_phone`} className={lbl}>Phone</label>
                  <input id={`dpo_${i}_phone`} name={`dpo_${i}_phone`} {...PHONE} value={row.phone} onChange={(e) => set(i, { phone: e.target.value })} className={field} />
                </div>
                {/* unused person fields submitted empty so the keys always exist */}
                <input type="hidden" name={`dpo_${i}_first`} value="" />
                <input type="hidden" name={`dpo_${i}_last`} value="" />
                <input type="hidden" name={`dpo_${i}_title`} value="" />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input type="hidden" name={`dpo_${i}_company`} value="" />
                <div><label htmlFor={`dpo_${i}_first`} className={lbl}>First name</label><input id={`dpo_${i}_first`} name={`dpo_${i}_first`} value={row.first} onChange={(e) => set(i, { first: e.target.value })} className={field} /></div>
                <div><label htmlFor={`dpo_${i}_last`} className={lbl}>Last name</label><input id={`dpo_${i}_last`} name={`dpo_${i}_last`} value={row.last} onChange={(e) => set(i, { last: e.target.value })} className={field} /></div>
                <div><label htmlFor={`dpo_${i}_title`} className={lbl}>Job title</label><input id={`dpo_${i}_title`} name={`dpo_${i}_title`} value={row.title} onChange={(e) => set(i, { title: e.target.value })} className={field} /></div>
                <div><label htmlFor={`dpo_${i}_email`} className={lbl}>Email</label><input id={`dpo_${i}_email`} name={`dpo_${i}_email`} type="email" value={row.email} onChange={(e) => set(i, { email: e.target.value })} className={field} /></div>
                <div className="sm:col-span-2"><label htmlFor={`dpo_${i}_phone`} className={lbl}>Phone</label><input id={`dpo_${i}_phone`} name={`dpo_${i}_phone`} {...PHONE} value={row.phone} onChange={(e) => set(i, { phone: e.target.value })} className={field} /></div>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} className="mt-2 rounded-md border border-[#003566] px-3 py-1.5 text-sm font-medium text-[#003566] hover:bg-[#003566]/5">
        + Add another DPO
      </button>
      {hasContacts && <p className="mt-2 text-xs text-neutral-500">New people (not picked from the list) are added to HubSpot automatically.</p>}
    </fieldset>
  );
}

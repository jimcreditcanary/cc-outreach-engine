"use client";

// Postcode → address autocomplete for the public merchant form. Renders the
// address inputs itself (names passed in, so the surrounding server-action form
// submits them) plus a "Find address" button that hits /m/address and lets the
// user pick a result to fill the fields. Degrades to plain typing if lookup
// returns nothing.

import { useState } from "react";

interface Result { summaryline: string; line1: string; line2: string; city: string; postcode: string }

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";

export function AddressLookup({
  line1Name, line2Name, cityName, postcodeName, countryName, defaults,
}: {
  line1Name: string; line2Name: string; cityName: string; postcodeName: string; countryName: string;
  defaults?: { line1?: string; line2?: string; city?: string; postcode?: string; country?: string };
}) {
  const [line1, setLine1] = useState(defaults?.line1 ?? "");
  const [line2, setLine2] = useState(defaults?.line2 ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");
  const [postcode, setPostcode] = useState(defaults?.postcode ?? "");
  const [country, setCountry] = useState(defaults?.country ?? "United Kingdom");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  async function find() {
    if (!postcode.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/m/address?postcode=${encodeURIComponent(postcode.trim())}`);
      const data = (await res.json()) as { addresses?: Result[] };
      setResults(data.addresses ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function pick(r: Result) {
    setLine1(r.line1);
    setLine2(r.line2);
    setCity(r.city);
    setPostcode(r.postcode);
    setResults([]);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={postcode} onChange={(e) => setPostcode(e.target.value)} name={postcodeName} placeholder="Postcode" className={field} />
        <button type="button" onClick={find} disabled={loading} className="shrink-0 rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
          {loading ? "…" : "Find address"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded border border-neutral-200 bg-white text-sm">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(r)} className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100">{r.summaryline}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={line1} onChange={(e) => setLine1(e.target.value)} name={line1Name} placeholder="Address line 1" className={field} />
        <input value={line2} onChange={(e) => setLine2(e.target.value)} name={line2Name} placeholder="Address line 2" className={field} />
        <input value={city} onChange={(e) => setCity(e.target.value)} name={cityName} placeholder="Town / city" className={field} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} name={countryName} placeholder="Country" className={field} />
      </div>
    </div>
  );
}

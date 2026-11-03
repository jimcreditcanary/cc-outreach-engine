"use client";

// Type-ahead picker backed by live HubSpot search (/api/hubspot/search). Used
// where the option set is too large to preload (12k+ companies/contacts) — the
// meeting page's Company / Contact / Deal links. Posts TWO hidden inputs:
//
//   <input name={idName}>   → the picked HubSpot id ("" when cleared)
//   <input name={nameName}> → a snapshot of the picked label (so the list +
//                             detail render without a runtime HubSpot lookup)
//
// Seed with the currently-linked id + label so it shows the existing selection.

import { useEffect, useRef, useState } from "react";

interface Hit { id: string; label: string; sublabel?: string }

export function HubspotPicker({
  type, idName, nameName, defaultId, defaultLabel, placeholder,
}: {
  type: "company" | "contact" | "deal";
  idName: string;
  nameName: string;
  defaultId?: string | null;
  defaultLabel?: string | null;
  placeholder?: string;
}) {
  const [text, setText] = useState(defaultLabel ?? "");
  const [picked, setPicked] = useState<{ id: string; label: string }>({ id: defaultId ?? "", label: defaultLabel ?? "" });
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hubspot/search?type=${type}&q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setHits(Array.isArray(data) ? data : []);
      } catch { setHits([]); }
      finally { setLoading(false); }
    }, 250);
  };

  const choose = (h: Hit) => { setPicked({ id: h.id, label: h.label }); setText(h.label); setOpen(false); };
  const clear = () => { setPicked({ id: "", label: "" }); setText(""); setHits([]); setOpen(false); };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); setPicked({ id: "", label: "" }); setOpen(true); search(e.target.value); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Type to search HubSpot…"}
        className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        autoComplete="off"
      />
      <input type="hidden" name={idName} value={picked.id} />
      <input type="hidden" name={nameName} value={picked.label} />

      {(picked.id || loading) && (
        <div className="absolute right-1 top-1.5 flex items-center gap-1 text-xs">
          {loading && <span className="text-neutral-400">…</span>}
          {picked.id && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700">HS ✓</span>}
          {(picked.id || text) && (
            <button type="button" onClick={clear} className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear" title="Clear">×</button>
          )}
        </div>
      )}

      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg" role="listbox">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(h)}
              className="flex w-full flex-col items-start px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-orange-50"
              role="option"
            >
              <span>{h.label}</span>
              {h.sublabel && <span className="text-xs text-neutral-500">{h.sublabel}</span>}
            </button>
          ))}
        </div>
      )}
      {open && !loading && text.trim().length >= 2 && hits.length === 0 && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-400 shadow-lg">No HubSpot matches.</div>
      )}
    </div>
  );
}

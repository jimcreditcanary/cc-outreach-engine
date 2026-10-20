"use client";

// Multi-stage filter for the Deals list: a single dropdown with stages grouped
// by pipeline and a checkbox each. Applying pushes the `stages` param (comma-
// joined ids) and resets pagination; the server does the actual filtering.

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

export interface StagePipeline {
  id: string;
  label: string;
  stages: { id: string; label: string }[];
}

export function StageFilterDropdown({
  pipelines,
  selected,
  q,
  sortRaw,
}: {
  pipelines: StagePipeline[];
  selected: string[];
  q?: string;
  sortRaw?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(selected));
  const ref = useRef<HTMLDivElement>(null);

  // Keep local state in sync if the URL-derived selection changes.
  useEffect(() => { setChecked(new Set(selected)); }, [selected.join(",")]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = (next: Set<string>) => {
    const p = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(sortRaw ? { sort: sortRaw } : {}),
      ...(next.size ? { stages: [...next].join(",") } : {}),
    });
    router.push(`/deals${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
    apply(next);
  };

  const clear = () => { setChecked(new Set()); apply(new Set()); setOpen(false); };

  const count = checked.size;
  const summary = count === 0 ? "All stages" : `${count} stage${count > 1 ? "s" : ""}`;

  return (
    <div ref={ref} className="relative inline-block text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
        aria-expanded={open}
      >
        <span className="text-xs uppercase tracking-wide text-neutral-400">Stage</span>
        <span className="font-medium">{summary}</span>
        <ChevronDown size={15} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          {pipelines.map((pl) => (
            <div key={pl.id} className="mb-2 last:mb-0">
              <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{pl.label}</div>
              {pl.stages.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-50">
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} className="accent-amber-600" />
                  <span className="text-neutral-700">{s.label.trim()}</span>
                </label>
              ))}
            </div>
          ))}
          {count > 0 && (
            <div className="mt-1 border-t border-neutral-100 pt-1">
              <button type="button" onClick={clear} className="w-full rounded px-1.5 py-1 text-left text-xs text-blue-700 hover:bg-neutral-50">Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

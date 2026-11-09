"use client";

// Client shell for the Dashboards tab: the Deal-owner filter (writes ?owner to
// the URL for server-side filtering) and the Revenue / Pipeline / Activity tab
// switch. Panels are server-rendered and passed in as `content`; switching tabs
// toggles a hidden class so nothing re-fetches.

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface DashTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export function DashShell({ tabs, owners, activeOwner }: { tabs: DashTab[]; owners: { id: string; name: string }[]; activeOwner: string | null }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setOwner(id: string) {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("owner", id);
    else p.delete("owner");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-current={on ? "page" : undefined}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  on ? "border-amber-600 text-amber-800" : "border-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-neutral-500">
          Deal owner
          <select
            value={activeOwner ?? ""}
            onChange={(e) => setOwner(e.target.value)}
            className="cc-select rounded border border-neutral-300 py-1 pl-2 pr-8 text-sm text-neutral-800"
          >
            <option value="">All owners</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      </div>

      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? "" : "hidden"}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

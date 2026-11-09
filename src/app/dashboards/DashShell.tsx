"use client";

// Client shell for the Dashboards tab: tab switch, Deal-owner filter, Pipeline
// filter buttons, and a Refresh button. Filters write to the URL (?owner /
// ?pipeline) for server-side filtering; Refresh re-reads the mirror + ledger.
// Panels are server-rendered and passed in as `content`; switching tabs toggles
// a hidden class so nothing re-fetches.

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { resyncDealsAction } from "./actions";

export interface DashTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

function shortPipeline(label: string): string {
  return label.replace(/\s*Pipeline$/i, "").trim() || label;
}

export function DashShell({
  tabs, owners, activeOwner, pipelines, activePipeline,
}: {
  tabs: DashTab[];
  owners: { id: string; name: string }[];
  activeOwner: string | null;
  pipelines: { id: string; label: string }[];
  activePipeline: string | null;
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [refreshing, startRefresh] = useTransition();

  function setParam(key: string, val: string) {
    const p = new URLSearchParams(sp.toString());
    if (val) p.set(key, val);
    else p.delete(key);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div>
      {/* Tabs · refresh · owner */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200">
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
        <div className="flex items-center gap-3 pb-2">
          <button
            type="button"
            onClick={() => startRefresh(async () => { await resyncDealsAction(); router.refresh(); })}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-60"
            title="Pull deals fresh from HubSpot, then reload"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Syncing…" : "Refresh"}
          </button>
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Deal owner
            <select
              value={activeOwner ?? ""}
              onChange={(e) => setParam("owner", e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-800"
            >
              <option value="">All owners</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Pipeline filter buttons */}
      {pipelines.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Pipeline</span>
          {pipelines.map((p) => (
            <PipeBtn key={p.id} on={activePipeline === p.id} onClick={() => setParam("pipeline", p.id)}>
              {shortPipeline(p.label)}
            </PipeBtn>
          ))}
        </div>
      )}

      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? "" : "hidden"}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

function PipeBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on ? "border-amber-600 bg-amber-50 text-amber-800" : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

// Dashboard data layer — deals. Reads the local HubSpot mirror
// (`hs_mirror_deals`, kept fresh by the hubspot-mirror cron) rather than
// hammering the HubSpot API, and resolves each deal's stage against the live
// pipeline metadata so we know open/won/lost + win probability. All custom
// deal props (TCV/ARR/CARR/one-off, lost reason …) are in `properties` because
// the mirror syncs every custom property.

import { serviceClient } from "@/lib/db/client";
import { hsFetch } from "@/lib/hubspot/client";
import { listOwners, ownerName, type Owner } from "@/lib/hubspot/owners";

export interface StageMeta {
  id: string;
  label: string;
  pipelineId: string;
  pipelineLabel: string;
  isClosed: boolean;
  probability: number; // 0..1
  isWon: boolean;
  isLost: boolean;
}

export interface DashDeal {
  id: string;
  name: string | null;
  stageId: string | null;
  stageLabel: string | null;
  pipelineId: string | null;
  pipelineLabel: string | null;
  ownerId: string | null;
  ownerName: string;
  amount: number | null;
  tcv: number | null;
  recurringTcv: number | null;
  oneoffFees: number | null;
  avgArr: number | null; // average_arr_combined
  carr: number | null; // carr_combined
  closeDate: Date | null;
  createdAt: Date | null;
  lastModified: Date | null;
  lastContacted: Date | null;
  isClosed: boolean;
  isWon: boolean;
  isLost: boolean;
  isOpen: boolean;
  probability: number;
  weighted: number; // (tcv ?? amount) × probability
  value: number; // tcv ?? amount ?? 0, for sizing
  dealType: string | null; // newbusiness | existingbusiness | …
  closedLostReason: string | null;
  lostTo: string | null;
}

type Props = Record<string, string | null | undefined>;

const num = (v: string | null | undefined): number | null =>
  v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

// HubSpot dates come as epoch-ms (numeric string) or ISO. Parse either.
function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const d = /^\d+$/.test(s) ? new Date(Number(s)) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Live pipeline stage metadata: stage id → {labels, open/won/lost, probability}. */
export async function loadStageMeta(): Promise<Map<string, StageMeta>> {
  const res = await hsFetch<{
    results: { id: string; label: string; stages?: { id: string; label: string; metadata?: { isClosed?: string | boolean; probability?: string | number } }[] }[];
  }>(`/crm/v3/pipelines/deals`, { cacheTtl: 300_000 });

  const map = new Map<string, StageMeta>();
  for (const p of res.results ?? []) {
    for (const s of p.stages ?? []) {
      const isClosed = s.metadata?.isClosed === true || s.metadata?.isClosed === "true";
      const prob = Number(s.metadata?.probability ?? 0);
      const probability = Number.isFinite(prob) ? prob : 0;
      const isWon = isClosed && probability >= 1;
      const isLost = isClosed && probability <= 0;
      map.set(s.id, { id: s.id, label: s.label, pipelineId: p.id, pipelineLabel: p.label, isClosed, probability, isWon, isLost });
    }
  }
  return map;
}

function mapDeal(row: { id: string; dealname: string | null; amount: number | null; dealstage: string | null; properties: Props }, stages: Map<string, StageMeta>, owners: Map<string, Owner>): DashDeal {
  const p = row.properties ?? {};
  const stageId = row.dealstage ?? p.dealstage ?? null;
  const stage = stageId ? stages.get(stageId) ?? null : null;
  const amount = row.amount ?? num(p.amount);
  const tcv = num(p.tcv);
  // Best available deal value: the custom TCV, else HubSpot's standard TCV
  // (rolled up from line items), else the deal amount.
  const value = tcv ?? num(p.hs_tcv) ?? amount ?? 0;
  const probability = stage?.probability ?? 0;
  const ownerId = p.hubspot_owner_id ?? null;
  // Fall back to the raw hs_is_closed flag when the stage isn't in the pipeline map.
  const closedFlag = p.hs_is_closed === "true" || p.hs_is_closed === "1";
  const isClosed = stage?.isClosed ?? closedFlag;
  const isWon = stage?.isWon ?? false;
  const isLost = stage?.isLost ?? (isClosed && !isWon);

  return {
    id: row.id,
    name: row.dealname ?? p.dealname ?? null,
    stageId,
    stageLabel: stage?.label ?? null,
    pipelineId: stage?.pipelineId ?? null,
    pipelineLabel: stage?.pipelineLabel ?? null,
    ownerId,
    ownerName: ownerName(owners, ownerId) ?? "Unassigned",
    amount,
    tcv,
    recurringTcv: num(p.recurring_tcv),
    oneoffFees: num(p.oneoff_fees),
    avgArr: num(p.average_arr_combined) ?? num(p.hs_arr),
    carr: num(p.carr_combined),
    closeDate: toDate(p.closedate),
    createdAt: toDate(p.createdate),
    lastModified: toDate(p.hs_lastmodifieddate),
    lastContacted: toDate(p.notes_last_contacted),
    isClosed,
    isWon,
    isLost,
    isOpen: !isClosed,
    probability,
    weighted: value * probability,
    value,
    dealType: p.dealtype ?? null,
    closedLostReason: p.closed_lost_reason ?? null,
    lostTo: p.lost_to ?? p.lost_to__competitor ?? null,
  };
}

export interface Pipeline { id: string; label: string }

/** All mirrored deals mapped into the dashboard shape, plus the owner + pipeline
 *  lists for the filters. Best-effort: empty on failure so dashboards degrade. */
export async function loadDeals(): Promise<{ deals: DashDeal[]; owners: Owner[]; pipelines: Pipeline[] }> {
  try {
    const db = serviceClient();
    const [res, stages, ownersMap] = await Promise.all([
      db.from("hs_mirror_deals").select("id, dealname, amount, dealstage, properties").limit(10000),
      loadStageMeta().catch(() => new Map<string, StageMeta>()),
      listOwners().catch(() => new Map<string, Owner>()),
    ]);
    const rows = (res.data ?? []) as { id: string; dealname: string | null; amount: number | null; dealstage: string | null; properties: Props }[];
    const deals = rows.map((r) => mapDeal(r, stages, ownersMap));
    // Owners that actually own a deal, sorted — the filter only needs those.
    const seen = new Map<string, Owner>();
    for (const d of deals) {
      if (d.ownerId && !seen.has(d.ownerId)) seen.set(d.ownerId, { id: d.ownerId, name: d.ownerName, email: null });
    }
    const owners = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Pipelines present among the deals, by open-deal count (busiest first).
    const pipeCount = new Map<string, { label: string; n: number }>();
    for (const d of deals) {
      if (!d.pipelineId || !d.pipelineLabel) continue;
      const cur = pipeCount.get(d.pipelineId) ?? { label: d.pipelineLabel, n: 0 };
      cur.n += 1;
      pipeCount.set(d.pipelineId, cur);
    }
    const pipelines = [...pipeCount.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, v]) => ({ id, label: v.label }));
    return { deals, owners, pipelines };
  } catch {
    return { deals: [], owners: [], pipelines: [] };
  }
}

// ── aggregation helpers ─────────────────────────────────────────────────────

/** Last `n` calendar months as YYYY-MM keys, oldest → newest (incl. current). */
export function recentMonths(n: number, from = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" → "Sep 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function sum(ns: (number | null | undefined)[]): number {
  return ns.reduce<number>((s, n) => s + (n ?? 0), 0);
}

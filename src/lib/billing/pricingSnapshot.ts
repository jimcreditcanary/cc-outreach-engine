// Line-level price snapshot (L2/L3). At activation each billing item freezes the
// pricing that was in force — metric, VAT, bands, merged config, band mode,
// product group and the catalogue version it came from — into billing_items
// .priced_snapshot. The invoice run reads this instead of the live catalogue, so
// editing a band in the catalogue never reprices a live contract; a deliberate
// super-admin "re-sync from catalogue" supersedes it. PURE (no DB/clock) so it
// unit-tests cleanly; the caller passes `now`.

import type { Metric, VatTreatment } from "./catalogue";
import type { ItemConfig } from "./itemConfig";
import type { EngineBand } from "./engine";
import type { PricingTable, PricingBand } from "./repo";

export interface PricedSnapshot {
  pricing_table_id: string | null;
  table_version: number | null;
  effective_from: string | null;   // catalogue version's effective_from
  metric: Metric;
  vat_treatment: VatTreatment;
  band_mode: "volume" | "graduated";
  product_group: string | null;
  config: ItemConfig;               // catalogue config ⊕ per-item config (override still layered at invoice time)
  bands: EngineBand[];
  snapped_at: string;               // ISO timestamp the snapshot was taken
}

function toEngineBand(b: Pick<PricingBand, "from_units" | "to_units" | "unit_price_pence" | "minimum_type" | "minimum_pence" | "unit_cap_pence">): EngineBand {
  return { from_units: b.from_units, to_units: b.to_units, unit_price_pence: b.unit_price_pence, minimum_type: b.minimum_type, minimum_pence: b.minimum_pence, unit_cap_pence: b.unit_cap_pence };
}

/** Freeze the pricing in force for one item. `table` is the current catalogue
 *  version for the item_type (null = no pricing table — snapshot still records
 *  the item's own config). `itemVat` is the per-item VAT override. */
export function buildPricingSnapshot(
  table: PricingTable | null,
  bands: PricingBand[],
  itemConfig: Record<string, unknown>,
  itemVat: string | null,
  fallbackMetric: Metric,
  now: string,
): PricedSnapshot {
  const tableCfg = (table?.config ?? {}) as ItemConfig;
  return {
    pricing_table_id: table?.id ?? null,
    table_version: table?.version ?? null,
    effective_from: table?.effective_from ?? null,
    metric: (table?.metric ?? fallbackMetric) as Metric,
    vat_treatment: (itemVat as VatTreatment) ?? (table?.vat_treatment as VatTreatment) ?? "standard",
    band_mode: table?.band_mode ?? "volume",
    product_group: table?.product_group ?? null,
    config: { ...tableCfg, ...(itemConfig as ItemConfig) },
    bands: bands.map(toEngineBand),
    snapped_at: now,
  };
}

/** Narrow an unknown jsonb value to a usable snapshot, or null if it isn't one
 *  (pre-migration rows, or a partial write). */
export function asPricedSnapshot(v: unknown): PricedSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<PricedSnapshot>;
  if (!s.metric || !Array.isArray(s.bands) || !s.config) return null;
  return s as PricedSnapshot;
}

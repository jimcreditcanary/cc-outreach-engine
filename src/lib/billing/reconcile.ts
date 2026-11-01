// "Were we accurate?" — reconcile what a deal was SOLD (HubSpot deal line items,
// matched by SKU → our product key) against what we actually CONFIGURED to bill.
// Pure + deterministic. Flags: on the deal but not set up, set up but not on the
// deal, a SKU we don't recognise, and price differences. Money is integer pence;
// deal line prices arrive in pounds (HubSpot) and are converted here.

export interface DealLine {
  sku: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;   // unit price in POUNDS (HubSpot)
}

export interface ConfiguredItem {
  item_type: string;
  label: string;
  our_price_pence: number | null; // comparable unit/monthly price, or null when not a scalar (volume-banded / %)
}

export type ReconStatus = "ok" | "missing_setup" | "not_on_deal" | "price_mismatch" | "unmapped";

export interface ReconRow {
  item_type: string | null;        // resolved product key (null when the SKU didn't map)
  label: string;
  on_deal: boolean;
  configured: boolean;
  deal_price_pence: number | null;
  our_price_pence: number | null;
  status: ReconStatus;
  note?: string;
}

export interface ReconResult {
  rows: ReconRow[];
  accurate: boolean;
  issues: number;          // rows whose status isn't "ok"
  counts: Record<ReconStatus, number>;
}

/** Normalise a SKU / key for matching: lowercase, trimmed. Deal SKUs are
 *  expected to equal our item_type keys (Jim); an alias map can remap the rest. */
export function normaliseKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** The single comparable price (pence) for a product, or null when it has no
 *  scalar price (volume-banded per-unit, or a %). Used for the price check. */
export function comparablePricePence(
  metric: string,
  config: { amount_pence?: number; fixed_pence?: number },
  bands: { unit_price_pence: number }[],
): number | null {
  if (metric === "flat_monthly") return config.amount_pence ?? null;
  if (metric === "per_request" || metric === "per_account_month" || metric === "per_message" || metric === "per_number_month") {
    return bands.length === 1 ? bands[0]!.unit_price_pence : null; // single flat band only; volume tiers → not scalar
  }
  if (metric === "per_txn_fixed" || metric === "per_txn_fixed_and_pct") return config.fixed_pence ?? null;
  return null; // pct_of_principal, per_txn_pct — no single unit price to compare
}

export function reconcile(
  dealLines: DealLine[],
  configured: ConfiguredItem[],
  opts: { skuAliases?: Record<string, string>; knownKeys?: Set<string> } = {},
): ReconResult {
  const alias = opts.skuAliases ?? {};
  const byKey = new Map(configured.map((c) => [normaliseKey(c.item_type), c]));
  const known = opts.knownKeys ?? new Set(byKey.keys());
  const rows: ReconRow[] = [];
  const matchedKeys = new Set<string>();

  for (const d of dealLines) {
    const raw = normaliseKey(d.sku);
    const key = alias[raw] ?? raw;
    const dealPence = d.price != null ? Math.round(d.price * 100) : null;
    const cfg = key ? byKey.get(key) : undefined;

    if (!cfg) {
      // On the deal but either not configured, or a SKU we don't recognise.
      const unmapped = !key || !known.has(key);
      rows.push({
        item_type: key || null, label: d.name ?? d.sku ?? "(unnamed line)",
        on_deal: true, configured: false, deal_price_pence: dealPence, our_price_pence: null,
        status: unmapped ? "unmapped" : "missing_setup",
        note: unmapped ? "SKU doesn't match a known product" : "on the deal, not set up to bill",
      });
      continue;
    }

    matchedKeys.add(key);
    const priceMismatch = cfg.our_price_pence != null && dealPence != null && cfg.our_price_pence !== dealPence;
    rows.push({
      item_type: cfg.item_type, label: cfg.label,
      on_deal: true, configured: true, deal_price_pence: dealPence, our_price_pence: cfg.our_price_pence,
      status: priceMismatch ? "price_mismatch" : "ok",
      note: priceMismatch ? "deal price differs from our configured price" : undefined,
    });
  }

  // Configured but never referenced by a deal line.
  for (const c of configured) {
    if (matchedKeys.has(normaliseKey(c.item_type))) continue;
    rows.push({
      item_type: c.item_type, label: c.label, on_deal: false, configured: true,
      deal_price_pence: null, our_price_pence: c.our_price_pence, status: "not_on_deal",
      note: "set up to bill, not on the deal",
    });
  }

  const counts = { ok: 0, missing_setup: 0, not_on_deal: 0, price_mismatch: 0, unmapped: 0 } as Record<ReconStatus, number>;
  for (const r of rows) counts[r.status]++;
  const issues = rows.length - counts.ok;
  return { rows, accurate: issues === 0, issues, counts };
}

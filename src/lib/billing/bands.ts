// Pure parser for the /admin/pricing bands textarea. One band per line:
//   from_units | to_units(*=unbounded) | unit_price_pence | minimum_type | minimum_pence | unit_cap_pence(optional)
// Separators | or , are both accepted. The 6th field is the per-txn cap (volume
// products leave it blank). Kept separate from the server action so it's
// unit-testable.

import type { BandInput } from "./repo";

const MIN_TYPES = new Set(["none", "monthly", "on_band_hit"]);

export function parseBandsText(text: string): BandInput[] {
  const out: BandInput[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const parts = line.split(/[|,]/).map((p) => p.trim());
    const from = Number(parts[0] ?? 0) || 0;
    const toRaw = parts[1] ?? "";
    const to = toRaw === "" || toRaw === "*" ? null : Number(toRaw);
    const price = Math.round(Number(parts[2] ?? 0) || 0);
    const minTypeRaw = (parts[3] ?? "none").toLowerCase();
    const minimum_type = (MIN_TYPES.has(minTypeRaw) ? minTypeRaw : "none") as BandInput["minimum_type"];
    const minimum_pence = Math.round(Number(parts[4] ?? 0) || 0);
    const capRaw = parts[5] ?? "";
    const unit_cap_pence = capRaw === "" || capRaw === "*" ? null : Math.round(Number(capRaw) || 0);
    out.push({ from_units: from, to_units: Number.isNaN(to as number) ? null : to, unit_price_pence: price, minimum_type, minimum_pence, unit_cap_pence, sort_order: i });
  });
  return out;
}

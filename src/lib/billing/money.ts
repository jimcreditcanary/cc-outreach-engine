// Money helpers. Everything in the DB + engine is integer PENCE; format only
// at the edge.

/** Pence → "£1,234.56". Negative handled. */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}£${pounds.toLocaleString("en-GB")}.${rem.toString().padStart(2, "0")}`;
}

/** Parse a user-entered pounds string (e.g. "12.50", "1,000") to integer pence.
 *  Returns 0 for blank/invalid. */
export function poundsToPence(input: string): number {
  const cleaned = input.replace(/[£,\s]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Parse an integer pence string directly (for fields entered in pence). */
export function penceInput(input: string): number {
  const n = Number(String(input).replace(/[,\s]/g, "").trim());
  return Number.isNaN(n) ? 0 : Math.round(n);
}

export const VAT_STANDARD_RATE = 0.2;

/** VAT pence for a net amount under a treatment. */
export function vatPence(netPence: number, treatment: string): number {
  return treatment === "standard" ? Math.round(netPence * VAT_STANDARD_RATE) : 0;
}

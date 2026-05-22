// Parse a CRM export (CSV or xlsx) into rows keyed by their ORIGINAL
// header. Mapping/normalisation happens later in mappers.ts — this layer
// only turns bytes into objects.

import * as XLSX from "xlsx";
import type { RawRow } from "./mappers";

/**
 * Parse a file buffer into rows. xlsx handles both .xlsx and .csv, so we
 * route everything through it for a single code path; the first sheet is
 * used. `defval: ""` keeps every column present (empty string) so alias
 * lookups don't trip over missing keys.
 */
export function parseTabular(buffer: Buffer | ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false });
}

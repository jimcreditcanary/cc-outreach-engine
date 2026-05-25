// Parse a CRM export (CSV or xlsx) into rows keyed by their ORIGINAL
// header. Mapping/normalisation happens later in mappers.ts — this layer
// only turns bytes into objects.
//
// CSV and xlsx go down different paths on purpose:
//   • CSV  → csv-parse, UTF-8. Pipedrive CSVs are UTF-8; routing them
//     through the xlsx reader decoded £/'/" as Latin-1 mojibake and
//     silently reformatted date columns (e.g. "2022-06-13" → "6/13/22").
//     csv-parse keeps the raw string values and decodes UTF-8 correctly.
//   • xlsx → SheetJS, first sheet.

import * as XLSX from "xlsx";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { RawRow } from "./mappers";

export function parseCsv(buffer: Buffer): RawRow[] {
  return parseCsvSync(buffer, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: false,
  }) as RawRow[];
}

export function parseXlsx(buffer: Buffer | ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false });
}

/**
 * Parse by file kind. Pass the filename so we can route .csv → csv-parse
 * and everything else → xlsx. With no filename, assumes xlsx.
 */
export function parseTabular(buffer: Buffer, filename?: string): RawRow[] {
  if (filename && /\.csv$/i.test(filename)) return parseCsv(buffer);
  return parseXlsx(buffer);
}

// Shared table-sort contract. One URL param, `sort`, encodes column +
// direction: "name" (asc) / "-name" (desc). Paginated tables feed sort.col
// into the DB .order(); small fully-loaded tables sort the array via
// sortRows(). The clickable headers are rendered by <SortableTh>.

export interface Sort {
  col: string;
  dir: "asc" | "desc";
}

/** Parse the `sort` param against an allow-list, falling back to `def`. */
export function parseSort(raw: string | undefined, allowed: readonly string[], def: Sort): Sort {
  if (!raw) return def;
  const desc = raw.startsWith("-");
  const col = desc ? raw.slice(1) : raw;
  if (!allowed.includes(col)) return def;
  return { col, dir: desc ? "desc" : "asc" };
}

/** In-memory sort for fully-loaded (non-paginated) tables. `get` maps a row +
 *  column key to its sortable value. Nulls sort last; numbers numerically;
 *  everything else as a locale-aware, number-aware string. */
export function sortRows<T>(rows: T[], sort: Sort, get: (row: T, col: string) => unknown): T[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a, sort.col);
    const vb = get(b, sort.col);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb), "en", { numeric: true, sensitivity: "base" }) * mul;
  });
}

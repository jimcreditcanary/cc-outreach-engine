// Clickable table header that toggles the shared `sort` URL param. Server
// component (just a Link) — no client JS. Clicking a column sets asc, clicking
// the active column again flips to desc. Preserves the page's other params.

import Link from "next/link";
import type { Sort } from "@/lib/table/sort";

export function SortableTh({
  label,
  col,
  sort,
  basePath,
  params,
  className,
}: {
  label: string;
  col: string;
  sort: Sort;
  basePath: string;
  /** Other query params to keep when re-sorting (q, owner, tab, status…). */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  const active = sort.col === col;
  const nextDesc = active && sort.dir === "asc";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) qs.set(k, v);
  qs.set("sort", `${nextDesc ? "-" : ""}${col}`);
  return (
    <th className={className}>
      <Link href={`${basePath}?${qs.toString()}`} scroll={false} className="group inline-flex items-center gap-1 hover:text-neutral-700">
        <span>{label}</span>
        <span className={`text-[10px] ${active ? "text-amber-600" : "text-neutral-300 group-hover:text-neutral-400"}`}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

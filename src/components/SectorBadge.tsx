// Tiny presentational chip for a company's sector. Title-cased copy,
// neutral pill style — consistent everywhere a sector renders.
//
// Renders nothing when the sector is null/undefined/empty so callers
// can drop it in without their own conditional.

import { formatSector } from "@/lib/format/sector";

export function SectorBadge({
  sector,
  className,
}: {
  sector: string | null | undefined;
  className?: string;
}) {
  if (!sector) return null;
  return (
    <span
      className={
        "inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 " +
        (className ?? "")
      }
    >
      {formatSector(sector)}
    </span>
  );
}

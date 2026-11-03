"use client";

// A filter <select> that navigates on change, preserving the other query params
// and resetting pagination. Used for the companies/contacts feature filters.

import { useRouter, useSearchParams } from "next/navigation";

export interface NavSelectOption { value: string; label: string }

export function NavSelect({
  param, value, options, allLabel = "All", basePath, ariaLabel,
}: {
  param: string;
  value?: string;
  options: NavSelectOption[];
  allLabel?: string;
  basePath: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <select
      value={value ?? ""}
      aria-label={ariaLabel ?? param}
      onChange={(e) => {
        const next = new URLSearchParams(sp.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        next.delete("after"); // filtering invalidates the current page cursor
        router.push(`${basePath}?${next.toString()}`);
      }}
      className="rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

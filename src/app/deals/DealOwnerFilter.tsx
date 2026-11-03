"use client";

// Owner filter for the HubSpot deals board. HubSpot owner ids (not the local
// operator mapping the Supabase OwnerFilter uses), so it's its own control.
// Navigates on change, preserving the other query params (pipeline, q).

import { useRouter, useSearchParams } from "next/navigation";

export function DealOwnerFilter({ owners, value }: { owners: { id: string; name: string }[]; value?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("owner", e.target.value);
        else next.delete("owner");
        router.push(`/deals?${next.toString()}`);
      }}
      className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700"
      aria-label="Filter by owner"
    >
      <option value="">All owners</option>
      {owners.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

// Compact "show only my stuff / everyone's / a specific operator's" filter
// that lives in the header of every list page + the dashboard. Renders as
// a GET form so the result is a sharable URL — the page server-reads
// searchParams.owner and applies it server-side.

import Link from "next/link";
import { listOperators, currentUserId } from "@/lib/auth/owner";

export async function OwnerFilter({
  current,
  pathname,
  extraParams = {},
}: {
  /** Raw ?owner= value from searchParams (may be undefined → defaults to "me"). */
  current: string | undefined;
  /** Path the links point at, e.g. "/companies". */
  pathname: string;
  /** Other search params to preserve in the link URLs. */
  extraParams?: Record<string, string | undefined>;
}) {
  const [operators, me] = await Promise.all([listOperators(), currentUserId()]);
  const effective = current ?? "me"; // default
  const buildHref = (owner: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) if (v) sp.set(k, v);
    sp.set("owner", owner);
    return `${pathname}?${sp.toString()}`;
  };
  const pillBase = "rounded px-2 py-0.5 text-xs border";
  const pillOn = "border-emerald-300 bg-emerald-50 text-emerald-800 font-medium";
  const pillOff = "border-neutral-200 text-neutral-600 hover:bg-neutral-50";
  const isUuid = effective.length >= 32;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
      <span className="mr-1">Owner:</span>
      <Link href={buildHref("me")} className={`${pillBase} ${effective === "me" ? pillOn : pillOff}`}>
        Me
      </Link>
      <Link href={buildHref("all")} className={`${pillBase} ${effective === "all" ? pillOn : pillOff}`}>
        Everyone
      </Link>
      {operators
        .filter((o) => o.id !== me)
        .map((o) => (
          <Link
            key={o.id}
            href={buildHref(o.id)}
            className={`${pillBase} ${isUuid && effective === o.id ? pillOn : pillOff}`}
            title={o.email ?? o.id}
          >
            {(o.email ?? o.id).split("@")[0]}
          </Link>
        ))}
    </div>
  );
}

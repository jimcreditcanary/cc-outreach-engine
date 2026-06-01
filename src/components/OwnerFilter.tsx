// Owner filter dropdown for list pages + dashboard. Renders as a GET form
// so the choice survives in the URL (sharable, back-button friendly). The
// page server-reads searchParams.owner and applies it server-side.

import { listOperators, currentUserId } from "@/lib/auth/owner";

export async function OwnerFilter({
  current,
  pathname,
  extraParams = {},
}: {
  /** Raw ?owner= value from searchParams (may be undefined → defaults to "me"). */
  current: string | undefined;
  /** Path the form posts at, e.g. "/companies". */
  pathname: string;
  /** Other search params to preserve when the dropdown changes. */
  extraParams?: Record<string, string | undefined>;
}) {
  const [operators, me] = await Promise.all([listOperators(), currentUserId()]);
  const effective = current ?? "me";

  return (
    <form action={pathname} method="get" className="flex items-center gap-2 text-xs text-neutral-500">
      {/* Preserve other filters in the URL when the operator changes. */}
      {Object.entries(extraParams).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <label htmlFor="owner-filter" className="uppercase tracking-wide">Owner</label>
      <select
        id="owner-filter"
        name="owner"
        defaultValue={effective}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
      >
        <option value="me">Me{me ? "" : ""}</option>
        <option value="all">All users</option>
        {operators
          .filter((o) => o.id !== me)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.email ?? o.id}
            </option>
          ))}
      </select>
      <button className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
        Apply
      </button>
    </form>
  );
}

// Colour-coded badge for a company's onboarding_status. Matches on the value's
// text so it works whatever exact option values the HubSpot property uses
// (Not Started / Pending / In Review / Complete).

export function OnboardingBadge({ status }: { status: string }) {
  const t = status.toLowerCase();
  const cls =
    /complet/.test(t) ? "bg-emerald-100 text-emerald-800" :
    /review/.test(t) ? "bg-blue-100 text-blue-800" :
    /pending|progress/.test(t) ? "bg-amber-100 text-amber-800" :
    /not.?start/.test(t) ? "bg-neutral-100 text-neutral-500" :
    "bg-neutral-100 text-neutral-600";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

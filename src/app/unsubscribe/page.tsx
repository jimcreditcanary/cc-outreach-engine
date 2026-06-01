import { submitUnsubscribe } from "./actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

const REASONS = [
  "Not relevant to my role",
  "Bad timing — try again later",
  "Already using something similar",
  "Too many emails",
  "Not interested in Credit Canary",
  "Other (see note)",
];

const RECONTACT = [
  { v: "never", label: "Never — please remove me" },
  { v: "3", label: "In 3 months" },
  { v: "6", label: "In 6 months" },
  { v: "12", label: "In a year" },
];

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; email?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const email = sp.e ?? sp.email ?? "";

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-8">
      <h1 className="mb-1 text-lg font-semibold">Sorry to see you go</h1>
      <p className="mb-6 text-sm text-neutral-500">
        A quick note on why helps us not annoy others. Optional but appreciated.
      </p>

      <form action={submitUnsubscribe} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Your email
          </label>
          <input
            name="email"
            type="email"
            defaultValue={email}
            required
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Why?
          </legend>
          <div className="space-y-1.5">
            {REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name="why" value={r} className="text-amber-700" />
                {r}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            When (if ever) is it OK to try again?
          </label>
          <select name="recontact" defaultValue="never" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm">
            {RECONTACT.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Anything you&apos;d like to add?
          </label>
          <textarea name="note" rows={3} className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" placeholder="(optional)" />
        </div>

        <PendingButton className="w-full rounded bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800" pendingLabel="Removing you…">
          Unsubscribe me
        </PendingButton>
        {sp.error === "missing-email" && (
          <p className="text-sm text-red-600">We need your email to remove you.</p>
        )}
      </form>

      <p className="mt-6 text-xs text-neutral-400">
        Jim Fell · Credit Canary · jim@creditcanary.co.uk
      </p>
    </main>
  );
}

import { loginAction } from "../auth-actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

// text-base (16px) on inputs stops iOS Safari zooming in on focus; py-2.5 gives
// a comfortable touch target. dvh centres cleanly despite mobile browser chrome.
const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base text-neutral-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-600 text-sm font-bold text-white">CC</div>
          <div>
            <h1 className="text-base font-semibold leading-tight text-neutral-900">Credit Canary — Outreach</h1>
            <p className="text-sm text-neutral-500">Operator sign in</p>
          </div>
        </div>

        <form action={loginAction} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputCls}
            />
          </div>
          <PendingButton
            className="w-full rounded-lg bg-amber-700 px-3 py-2.5 text-base font-medium text-white transition hover:bg-amber-800 disabled:opacity-60"
            pendingLabel="Signing in…"
          >
            Sign in
          </PendingButton>
          {error && <p className="text-sm text-red-600">{decodeURIComponent(error)}</p>}
        </form>
      </div>
    </main>
  );
}

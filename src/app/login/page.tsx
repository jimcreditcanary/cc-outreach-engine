import { loginAction } from "../auth-actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-lg font-semibold">Credit Canary — Outreach</h1>
      <p className="mb-4 text-sm text-neutral-500">Operator sign in.</p>
      <form action={loginAction} className="space-y-3">
        <input
          name="email"
          type="email"
          placeholder="email"
          autoComplete="username"
          autoFocus
          required
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          placeholder="password"
          autoComplete="current-password"
          required
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <PendingButton className="w-full rounded bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800" pendingLabel="Signing in…">
          Sign in
        </PendingButton>
        {error && <p className="text-sm text-red-600">{decodeURIComponent(error)}</p>}
      </form>
    </main>
  );
}

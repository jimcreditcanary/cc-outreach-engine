export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-lg font-semibold">Credit Canary — Outreach</h1>
      <p className="mb-4 text-sm text-neutral-500">Operator login.</p>
      <form action="/api/login" method="post" className="space-y-3">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <button className="w-full rounded bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800">
          Sign in
        </button>
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
      </form>
    </main>
  );
}

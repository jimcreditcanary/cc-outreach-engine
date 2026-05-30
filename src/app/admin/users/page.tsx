import { adminClient } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/server";
import { createUserAction, deleteUserAction, resetPasswordAction } from "../../auth-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await currentUser();
  const { data } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 100 });
  const users = data?.users ?? [];

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <span className="text-sm text-neutral-500">{users.length}</span>
      </header>

      <form action={createUserAction} className="mb-6 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="email" type="email" placeholder="email" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <input name="password" type="text" placeholder="temp password (8+ chars)" minLength={8} className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ Add user</button>
      </form>
      <p className="mb-4 text-xs text-neutral-400">User gets instant access — share the password with them, they can change it later via Supabase password reset.</p>

      <ul className="space-y-1 text-sm">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 bg-white px-3 py-2">
            <span>
              {u.email}
              {u.id === me?.id && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">you</span>}
              <span className="ml-2 text-xs text-neutral-400">last sign-in: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("en-GB") : "never"}</span>
            </span>
            <div className="flex items-center gap-2">
              <form action={resetPasswordAction} className="flex gap-1">
                <input type="hidden" name="id" value={u.id} />
                <input name="password" type="text" placeholder="new password" minLength={8} className="rounded border border-neutral-300 px-2 py-1 text-xs" required />
                <button className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100">reset</button>
              </form>
              {u.id !== me?.id && (
                <form>
                  <input type="hidden" name="id" value={u.id} />
                  <ConfirmSubmit
                    formAction={deleteUserAction}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    message={`Remove ${u.email} from the operator team?`}
                  >
                    remove
                  </ConfirmSubmit>
                </form>
              )}
            </div>
          </li>
        ))}
        {users.length === 0 && <li className="text-neutral-400">No users yet.</li>}
      </ul>
    </main>
  );
}

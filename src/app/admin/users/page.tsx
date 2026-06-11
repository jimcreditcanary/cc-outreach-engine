import { currentUser } from "@/lib/auth/server";
import { listOperators, displayName } from "@/lib/auth/owner";
import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  reassignOwnershipAction,
  updateUserProfileAction,
} from "../../auth-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { RowIconAction } from "@/components/RowIconAction";
import { PendingButton } from "@/components/PendingButton";
import { fmtDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const cell = "rounded border border-neutral-300 px-2 py-1 text-xs";

export default async function UsersPage() {
  const me = await currentUser();
  // listOperators returns auth users joined with user_settings, so we get
  // first/last/job_title alongside email in one shot.
  const users = await listOperators();

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <span className="text-sm text-neutral-500">{users.length}</span>
      </header>

      {/* Create form — accepts profile fields up-front so new users land
          already named, not as "rosst@…" in every dropdown. */}
      <form action={createUserAction} className="mb-2 grid grid-cols-12 gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="first_name" placeholder="first name" className="col-span-2 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="last_name" placeholder="last name" className="col-span-2 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="job_title" placeholder="job title" className="col-span-2 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="email" type="email" placeholder="email" className="col-span-3 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <input name="password" type="text" placeholder="temp password (8+)" minLength={8} className="col-span-2 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <PendingButton className="col-span-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="…">+ Add</PendingButton>
      </form>
      <p className="mb-4 text-xs text-neutral-400">User gets instant access — share the password with them, they can change it later via Supabase password reset.</p>

      <ul className="space-y-2 text-sm">
        {users.map((u) => (
          <li key={u.id} className="rounded border border-neutral-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-neutral-800">{displayName(u)}</span>
              {u.email && <span className="text-xs text-neutral-500">· {u.email}</span>}
              {u.id === me?.id && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">you</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Inline profile editor — single form, single save. */}
              <form action={updateUserProfileAction} className="flex flex-wrap items-center gap-1">
                <input type="hidden" name="id" value={u.id} />
                <input name="first_name" defaultValue={u.first_name ?? ""} placeholder="first" className={cell} />
                <input name="last_name" defaultValue={u.last_name ?? ""} placeholder="last" className={cell} />
                <input name="job_title" defaultValue={u.job_title ?? ""} placeholder="job title" className={`${cell} w-40`} />
                <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100" pendingLabel="…">
                  Save profile
                </PendingButton>
              </form>

              <span className="ml-auto text-xs text-neutral-400">
                last sign-in: {u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "never"}
              </span>

              <form action={resetPasswordAction} className="flex gap-1">
                <input type="hidden" name="id" value={u.id} />
                <input name="password" type="text" placeholder="new password" minLength={8} className={cell} required />
                <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100" pendingLabel="…">reset</PendingButton>
              </form>

              {u.id !== me?.id && (
                <form>
                  <input type="hidden" name="id" value={u.id} />
                  <RowIconAction
                    kind="delete"
                    formAction={deleteUserAction}
                    confirmMessage={`Remove ${displayName(u)} from the operator team?`}
                    title="Remove user"
                  />
                </form>
              )}
            </div>
          </li>
        ))}
        {users.length === 0 && <li className="text-neutral-400">No users yet.</li>}
      </ul>

      {users.length >= 2 && (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Reassign ownership</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Bulk-move every company / contact / deal / send / meeting / note owned by one user to another.
            Run this <em>before</em> removing a user — otherwise their rows fall back to unassigned and you&apos;ll need to claim each one by hand.
          </p>
          <form action={reassignOwnershipAction} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">From</label>
              <select name="source_id" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" required defaultValue="">
                <option value="" disabled>pick user…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
              </select>
            </div>
            <span className="self-center text-neutral-400">→</span>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">To</label>
              <select name="target_id" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" required defaultValue="">
                <option value="" disabled>pick user…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
              </select>
            </div>
            <ConfirmSubmit
              formAction={reassignOwnershipAction}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              message="Re-assign EVERY row owned by the source user to the target user? Not reversible without a similar reverse run."
            >
              Re-assign all
            </ConfirmSubmit>
          </form>
        </section>
      )}
    </main>
  );
}


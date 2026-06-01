import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { redirect } from "next/navigation";
import { saveSenderIdentityAction } from "./actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { data } = await serviceClient()
    .from("user_settings")
    .select("from_email, reply_to_email")
    .eq("user_id", me.id)
    .maybeSingle();

  const envFrom = process.env.POSTMARK_FROM ?? "(POSTMARK_FROM unset)";
  const envReply = process.env.POSTMARK_REPLY_TO ?? "(POSTMARK_REPLY_TO unset)";

  return (
    <main className="px-8 py-6">
      <header className="mb-4 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-500">Signed in as {me.email}.</p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Outbound sender identity</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Every email you own (drafts you created, newsletter sends you trigger) goes out with the From / Reply-To below.
          Blank fields fall back to the workspace defaults set in Vercel env vars.
          <br />
          <strong>Important:</strong> your <code>From</code> address must already be a verified <em>Sender Signature</em> in Postmark
          (or live on a DKIM-verified sender domain), or Postmark will reject the send.
        </p>
        <form action={saveSenderIdentityAction} className="space-y-3">
          <div>
            <label className={lbl}>From — full RFC name + email</label>
            <input
              name="from_email"
              defaultValue={data?.from_email ?? ""}
              placeholder={envFrom}
              className={field}
            />
            <p className="mt-1 text-xs text-neutral-400">Format: <code>Your Name &lt;you@yourdomain.com&gt;</code>. Leave blank to inherit workspace default: <code>{envFrom}</code></p>
          </div>
          <div>
            <label className={lbl}>Reply-To</label>
            <input
              name="reply_to_email"
              defaultValue={data?.reply_to_email ?? ""}
              placeholder={envReply}
              className={field}
            />
            <p className="mt-1 text-xs text-neutral-400">Replies land in this inbox. Blank → workspace default: <code>{envReply}</code></p>
          </div>
          <PendingButton
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            pendingLabel="Saving…"
          >
            Save
          </PendingButton>
        </form>
      </section>
    </main>
  );
}

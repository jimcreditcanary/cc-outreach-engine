import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { redirect } from "next/navigation";
import {
  saveSenderIdentityAction,
  refreshSignatureStatusAction,
  resendSignatureConfirmationAction,
  saveGranolaTokenAction,
  syncGranolaNowAction,
  disconnectGranolaAction,
} from "./actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { data } = await serviceClient()
    .from("user_settings")
    .select("from_email, reply_to_email, postmark_signature_id, postmark_signature_verified, postmark_signature_error, postmark_signature_checked_at, granola_api_token")
    .eq("user_id", me.id)
    .maybeSingle();
  const granolaConnected = !!data?.granola_api_token;
  // Mask the token in the UI — only the last 4 chars are shown, so we
  // confirm "yes there's something here" without sending it back to the
  // browser.
  const granolaMasked = granolaConnected
    ? `••••${(data!.granola_api_token as string).slice(-4)}`
    : "";

  const envFrom = process.env.POSTMARK_FROM ?? "(POSTMARK_FROM unset)";
  const envReply = process.env.POSTMARK_REPLY_TO ?? "(POSTMARK_REPLY_TO unset)";
  const hasAccountToken = !!process.env.POSTMARK_ACCOUNT_TOKEN;

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
          {hasAccountToken
            ? " Saving will auto-register a Postmark sender signature for the From address — you'll get a confirmation email to click."
            : " Postmark signature auto-registration is OFF (POSTMARK_ACCOUNT_TOKEN env var not set). You'll need to register the From address manually in Postmark."}
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
            pendingLabel="Saving + registering with Postmark…"
          >
            Save
          </PendingButton>
        </form>

        {/* Postmark signature status — shows once the operator has saved a From */}
        {data?.from_email && (
          <div className="mt-5 rounded border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Postmark signature:</span>
              {data.postmark_signature_id ? (
                data.postmark_signature_verified
                  ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">✓ verified</span>
                  : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">pending — check inbox</span>
              ) : data.postmark_signature_error ? (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">registration failed</span>
              ) : (
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700">not registered yet</span>
              )}
              {data.postmark_signature_id && (
                <span className="text-xs text-neutral-400">id: {data.postmark_signature_id}</span>
              )}
              {data.postmark_signature_checked_at && (
                <span className="ml-auto text-xs text-neutral-400">
                  last checked {new Date(data.postmark_signature_checked_at).toLocaleString("en-GB")}
                </span>
              )}
            </div>
            {data.postmark_signature_error && (
              <p className="mb-2 text-xs text-red-700">{data.postmark_signature_error}</p>
            )}
            {data.postmark_signature_id && (
              <div className="flex flex-wrap gap-2">
                <form action={refreshSignatureStatusAction}>
                  <PendingButton
                    className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    pendingLabel="Checking…"
                    title="Re-poll Postmark for the current verified state"
                  >
                    Check status
                  </PendingButton>
                </form>
                {!data.postmark_signature_verified && (
                  <form action={resendSignatureConfirmationAction}>
                    <PendingButton
                      className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                      pendingLabel="Resending…"
                    >
                      Resend confirmation email
                    </PendingButton>
                  </form>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              Once verified, every email you own (queue drafts you created, newsletter sends you trigger) will go out from
              this address. Until then, sends fall back to the workspace default.
            </p>
          </div>
        )}
      </section>

      {/* Granola — pull post-meeting transcripts + auto-send follow-ups */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Granola — meeting transcripts</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Connect Granola and we&apos;ll automatically pull a transcript onto every meeting in your /meetings tab the moment
          Granola finishes processing it, then draft + auto-send a warm follow-up email to the primary contact
          (using your sender identity above). Runs every 15 min in the background.
        </p>
        <form action={saveGranolaTokenAction} className="space-y-2">
          <div>
            <label className={lbl}>Granola API token</label>
            <input
              name="granola_api_token"
              type="password"
              placeholder={granolaConnected ? `connected — token ending ${granolaMasked}; paste a new one to rotate` : "paste your token here…"}
              autoComplete="off"
              className={field}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Get one at <code>granola.ai</code> → Settings → Developer / API.
              Stored server-side only — never sent to the browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PendingButton
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              pendingLabel="Verifying with Granola…"
            >
              {granolaConnected ? "Replace token" : "Connect"}
            </PendingButton>
          </div>
        </form>
        {granolaConnected && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">✓ connected</span>
            <span className="text-neutral-500">Token ending {granolaMasked}. Sync runs every 15 min.</span>
            <form action={syncGranolaNowAction} className="ml-2">
              <PendingButton
                className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                pendingLabel="Syncing…"
              >
                Sync now
              </PendingButton>
            </form>
            <form action={disconnectGranolaAction}>
              <ConfirmSubmit
                className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                message="Disconnect Granola? The cron stops pulling transcripts. Existing transcripts + sent follow-ups stay put."
              >
                Disconnect
              </ConfirmSubmit>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

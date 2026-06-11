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
  saveBookingSettingsAction,
} from "./actions";
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
  disconnectMicrosoftAction,
  syncCalendarAction,
} from "../meetings/actions";
import { isConnected } from "@/lib/microsoft/oauth";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const db = serviceClient();
  // google_ics_url queried separately so the whole page doesn't blank out
  // if migration 034 hasn't run yet — only the Google card degrades.
  const [{ data }, { data: gcal }, { data: bk, error: bkErr }, msConnected] = await Promise.all([
    db
      .from("user_settings")
      .select("from_email, reply_to_email, postmark_signature_id, postmark_signature_verified, postmark_signature_error, postmark_signature_checked_at, granola_api_token")
      .eq("user_id", me.id)
      .maybeSingle(),
    db.from("user_settings").select("google_ics_url").eq("user_id", me.id).maybeSingle(),
    // Booking columns isolated too — migration 035 pending only greys this card.
    db
      .from("user_settings")
      .select("booking_slug, booking_duration_mins, booking_buffer_mins, booking_day_start, booking_day_end, booking_days, booking_tz, booking_title_template, booking_min_notice_hours")
      .eq("user_id", me.id)
      .maybeSingle(),
    isConnected(db, me.id),
  ]);
  const googleConnected = !!gcal?.google_ics_url;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  const bookingDays = (bk?.booking_days as string[] | null) ?? ["mon", "tue", "wed", "thu", "fri"];
  const DAYS: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

  const envFrom = process.env.POSTMARK_FROM ?? "(POSTMARK_FROM unset)";
  const envReply = process.env.POSTMARK_REPLY_TO ?? "(POSTMARK_REPLY_TO unset)";
  const hasAccountToken = !!process.env.POSTMARK_ACCOUNT_TOKEN;
  const granolaConnected = !!data?.granola_api_token;
  const granolaMasked = granolaConnected
    ? `••••${(data!.granola_api_token as string).slice(-4)}`
    : "";
  // The "share via email" fallback inbound address (set in Vercel).
  const granolaForwardAddress = process.env.GRANOLA_INBOUND_ADDRESS ?? "(set GRANOLA_INBOUND_ADDRESS env var)";

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

      {/* Calendars — Outlook (OAuth) + Google Calendar (secret iCal URL) */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Calendars — meeting sync</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Connected calendars feed <a href="/meetings" className="text-blue-700 hover:underline">/meetings</a> hourly:
          attendees are matched to contacts, companies + deals inferred automatically. You only ever see
          meetings from your own calendars (or ones you&apos;re invited to by email).
        </p>

        {/* Outlook / Microsoft 365 */}
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-neutral-800">Outlook / Microsoft 365</span>
            {msConnected ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">✓ connected</span>
            ) : (
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700">not connected</span>
            )}
            <span className="ml-auto" />
            {msConnected ? (
              <form action={disconnectMicrosoftAction}>
                <ConfirmSubmit
                  className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  message="Disconnect Outlook? Existing meetings stay; sync stops until you reconnect."
                >
                  Disconnect
                </ConfirmSubmit>
              </form>
            ) : (
              <a href="/api/auth/microsoft/start" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                Connect Outlook
              </a>
            )}
          </div>
        </div>

        {/* Google Calendar */}
        <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-neutral-800">Google Calendar</span>
            {googleConnected ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">✓ connected</span>
            ) : (
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700">not connected</span>
            )}
            <span className="ml-auto" />
            {googleConnected && (
              <form action={disconnectGoogleCalendarAction}>
                <ConfirmSubmit
                  className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  message="Disconnect Google Calendar? Existing meetings stay; sync stops. To fully revoke, also reset the secret address in Google Calendar settings."
                >
                  Disconnect
                </ConfirmSubmit>
              </form>
            )}
          </div>
          {!googleConnected && (
            <>
              <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-neutral-600">
                <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Google Calendar settings</a></li>
                <li>Under <strong>Settings for my calendars</strong>, pick your calendar</li>
                <li>Scroll to <strong>Integrate calendar</strong></li>
                <li>Copy the <strong>Secret address in iCal format</strong> (ends in .ics)</li>
              </ol>
              <form action={connectGoogleCalendarAction} className="mt-2 flex flex-wrap gap-2">
                <input
                  name="ics_url"
                  placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                  className="min-w-[18rem] flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs"
                  autoComplete="off"
                  required
                />
                <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700" pendingLabel="Connecting…">
                  Connect
                </PendingButton>
              </form>
              <p className="mt-2 text-[11px] text-neutral-400">
                The address is private to you — stored server-side only and never shown again, exactly like the Granola key.
              </p>
            </>
          )}
        </div>

        {(msConnected || googleConnected) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <form action={syncCalendarAction}>
              <PendingButton
                className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                pendingLabel="Syncing…"
              >
                Sync now
              </PendingButton>
            </form>
            <span className="text-neutral-500">Auto-sync runs hourly.</span>
          </div>
        )}
      </section>

      {/* Booking page — public Calendly-style /book/<slug> */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Booking page — share a link, get meetings</h2>
        <p className="mb-4 text-xs text-neutral-500">
          A public page where anyone can book a slot with you. Availability comes from your connected
          calendars above (plus existing CRM meetings); a booking creates the contact, the meeting, and
          either writes straight into your Outlook calendar or emails calendar invites to you both.
        </p>
        {bkErr ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Run migration <strong>035_booking.sql</strong> in Supabase to enable booking pages.
          </p>
        ) : (
          <>
            {bk?.booking_slug && (
              <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-emerald-700">Your booking link</span>
                <a href={`/book/${bk.booking_slug}`} target="_blank" rel="noreferrer" className="mt-0.5 block break-all font-medium text-emerald-900 underline">
                  {appUrl}/book/{bk.booking_slug}
                </a>
                <p className="mt-1 text-xs text-emerald-700">Share it anywhere — email signatures, LinkedIn, outreach footers.</p>
              </div>
            )}
            <form action={saveBookingSettingsAction} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={lbl}>Link name (clear to disable)</label>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap text-xs text-neutral-400">{appUrl.replace(/^https?:\/\//, "")}/book/</span>
                    <input name="booking_slug" defaultValue={bk?.booking_slug ?? ""} placeholder="jim" className={field} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Meeting title template</label>
                  <input
                    name="booking_title_template"
                    defaultValue={bk?.booking_title_template ?? ""}
                    placeholder="{operator} × {visitor}"
                    className={field}
                  />
                </div>
                <div>
                  <label className={lbl}>Duration</label>
                  <select name="booking_duration_mins" defaultValue={String(bk?.booking_duration_mins ?? 30)} className={field}>
                    {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Buffer around meetings</label>
                  <select name="booking_buffer_mins" defaultValue={String(bk?.booking_buffer_mins ?? 15)} className={field}>
                    {[0, 10, 15, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Day starts</label>
                  <input name="booking_day_start" type="time" defaultValue={bk?.booking_day_start ?? "09:00"} className={field} />
                </div>
                <div>
                  <label className={lbl}>Day ends</label>
                  <input name="booking_day_end" type="time" defaultValue={bk?.booking_day_end ?? "17:00"} className={field} />
                </div>
                <div>
                  <label className={lbl}>Minimum notice (hours)</label>
                  <input name="booking_min_notice_hours" type="number" min={0} max={168} defaultValue={String(bk?.booking_min_notice_hours ?? 4)} className={field} />
                </div>
                <div>
                  <label className={lbl}>Timezone (IANA)</label>
                  <input name="booking_tz" defaultValue={bk?.booking_tz ?? "Europe/London"} className={field} />
                </div>
              </div>
              <div>
                <label className={lbl}>Bookable days</label>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map(([v, label]) => (
                    <label key={v} className="flex items-center gap-1.5 text-sm text-neutral-700">
                      <input type="checkbox" name="booking_days" value={v} defaultChecked={bookingDays.includes(v)} className="h-4 w-4" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <PendingButton
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                pendingLabel="Saving…"
              >
                Save booking page
              </PendingButton>
              <p className="text-xs text-neutral-400">
                Tip: bookings write straight into Outlook calendars connected with the latest permissions —
                reconnect Outlook above once to enable that. Google (and older Outlook connections) get the
                invite by email instead.
              </p>
            </form>
          </>
        )}
      </section>

      {/* Granola — API key (primary) + email-forward (fallback) */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Granola — meeting transcripts</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Connect your Granola API key and we&apos;ll pull a transcript onto every sales-relevant meeting
          in /meetings automatically, draft an AI follow-up, and ship it from your sender identity.
          Cron runs every 15 min.
        </p>
        <form action={saveGranolaTokenAction} className="space-y-2">
          <div>
            <label className={lbl}>Granola API key</label>
            <input
              name="granola_api_token"
              type="password"
              placeholder={granolaConnected ? `connected — key ending ${granolaMasked}; paste a new one to rotate` : "paste your key here…"}
              autoComplete="off"
              className={field}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Get one at <code>granola.ai</code> → workspace settings → API keys → tick BOTH Personal + Public notes.
              Stored server-side only; never sent to the browser.
            </p>
          </div>
          <PendingButton
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            pendingLabel="Verifying with Granola…"
          >
            {granolaConnected ? "Replace key" : "Connect"}
          </PendingButton>
        </form>
        {granolaConnected && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">✓ connected</span>
            <span className="text-neutral-500">Key ending {granolaMasked}. Sync runs every 15 min.</span>
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
                message="Disconnect Granola? Existing transcripts + sent follow-ups stay put."
              >
                Disconnect
              </ConfirmSubmit>
            </form>
          </div>
        )}

        {/* Email-forward fallback — used when the API misses or for ad-hoc notes */}
        <details className="mt-5 text-xs text-neutral-500">
          <summary className="cursor-pointer font-medium text-neutral-700">Email-forward fallback (manual)</summary>
          <div className="mt-2 space-y-2">
            <p>
              If a note never makes it through the API (e.g. Granola hasn&apos;t finished transcribing,
              or the API misses an ad-hoc recording) you can manually share it via email and we&apos;ll
              still ingest it.
            </p>
            <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Forward Granola notes to</div>
              <code className="mt-0.5 block break-all text-sm text-neutral-800">{granolaForwardAddress}</code>
            </div>
            <p>
              In Granola: Share → Send via email → paste the address above. Send from your normal email
              account — we identify the operator from the From header.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}

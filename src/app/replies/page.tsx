// /replies — strictly scoped to the signed-in operator's inbound replies.
// We never show another operator's mail here — replies are private
// correspondence, scoped to the recipient inbox they landed in. The
// inbound webhook stamps events.owner_id by matching the To address
// against user_settings.reply_to_email / from_email, and this page
// always filters to that. Unmatched-sender replies still need triage
// (assign to an existing contact, or create a new one inline).

import Link from "next/link";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { currentUserId } from "@/lib/auth/owner";
import { Combobox } from "@/components/Combobox";
import { PendingButton } from "@/components/PendingButton";
import {
  assignReplyToContactAction,
  createContactFromReplyAction,
  dismissReplyAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface ReplyPayload {
  from?: string;
  from_name?: string | null;
  subject?: string;
  text_body?: string;
  html_body?: string;
  to?: string[];
  unmatched?: boolean;
  patched?: string[];
  dismissed_at?: string;
  signature_parsed?: { mobile?: string | null; job_title?: string | null; linkedin_url?: string | null } | null;
}
interface ReplyEvent {
  id: string;
  ts: string;
  owner_id: string | null;
  payload: ReplyPayload | null;
  contact: { id: string; full_name: string | null; email: string | null; organisation: { id: string; name: string | null } | null } | null;
}
interface OrgOpt { id: string; name: string | null }
interface ContactOpt { id: string; full_name: string | null; email: string | null; organisation: { name: string | null } | { name: string | null }[] | null }

export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const me = await currentUserId();
  if (!me) redirect("/login");
  const showDismissed = sp.show === "dismissed";
  const db = serviceClient();

  // ── Load replies, hard-scoped to the signed-in operator ──────────
  // events.owner_id is set by the inbound webhook from the To address
  // matching user_settings.reply_to_email / from_email. We never show
  // another operator's replies here — these are private inboxes.
  const { data, error } = await db
    .from("events")
    .select("id, ts, owner_id, payload, contact:contacts(id, full_name, email, organisation:organisations(id, name))")
    .eq("type", "reply")
    .eq("owner_id", me)
    .order("ts", { ascending: false })
    .limit(200);
  const replies = ((data ?? []) as unknown as ReplyEvent[]).filter((r) => {
    const dismissed = !!r.payload?.dismissed_at;
    return showDismissed ? dismissed : !dismissed;
  });

  // Picker data for unmatched triage — orgs + contacts the operator can
  // assign to. We don't filter by owner here because they may be replying
  // on behalf of someone whose contact already exists in another seat.
  const [{ data: orgsData }, { data: contactsData }] = await Promise.all([
    db.from("organisations").select("id, name").order("name").limit(2000),
    db.from("contacts").select("id, full_name, email, organisation:organisations(name)").order("full_name").limit(5000),
  ]);
  const orgs = (orgsData ?? []) as OrgOpt[];
  const contacts = (contactsData ?? []) as unknown as ContactOpt[];

  const orgOptions = orgs.map((o) => ({ id: o.id, label: o.name ?? "(unnamed org)" }));
  const contactOptions = contacts.map((c) => {
    const org = Array.isArray(c.organisation) ? c.organisation[0] : c.organisation;
    return {
      id: c.id,
      label: c.full_name ?? c.email ?? "(unnamed)",
      sublabel: org?.name ? `${org.name}${c.email ? ` · ${c.email}` : ""}` : c.email ?? undefined,
    };
  });

  const unmatchedCount = replies.filter((r) => r.payload?.unmatched).length;
  const matchedCount = replies.length - unmatchedCount;

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Replies to action</h1>
          <p className="text-sm text-neutral-500">
            {replies.length} reply{replies.length === 1 ? "" : "s"}
            {matchedCount > 0 && <> · {matchedCount} matched</>}
            {unmatchedCount > 0 && <> · <span className="text-red-700">{unmatchedCount} need triage</span></>}
            {showDismissed && <> · viewing dismissed</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={showDismissed ? "/replies" : "/replies?show=dismissed"}
            className="text-xs text-neutral-500 hover:underline"
          >
            {showDismissed ? "← back to live" : "view dismissed"}
          </Link>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn&apos;t load replies — likely migration 032 (events.owner_id) hasn&apos;t run yet.
          Error: {error.message}
        </p>
      )}

      {replies.length === 0 ? (
        <p className="text-neutral-500">No replies yet.</p>
      ) : (
        <ul className="space-y-3">
          {replies.map((r) => {
            const p = r.payload ?? {};
            const isUnmatched = !!p.unmatched;
            const body = (p.text_body ?? p.html_body ?? "").trim();
            const sig = p.signature_parsed ?? null;
            return (
              <li key={r.id} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 p-3 text-sm">
                    <span className="font-medium">
                      {r.contact?.full_name ?? p.from_name ?? p.from ?? "Unknown sender"}
                    </span>
                    {r.contact?.email && <span className="text-xs text-neutral-400">{r.contact.email}</span>}
                    {!r.contact?.email && p.from && <span className="text-xs text-neutral-400">{p.from}</span>}
                    {r.contact?.organisation?.name && (
                      <span className="text-neutral-500">— {r.contact.organisation.name}</span>
                    )}
                    {isUnmatched && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">unmatched — triage</span>
                    )}
                    {p.patched && p.patched.length > 0 && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800" title="Contact auto-patched from signature">
                        + {p.patched.join(", ")}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-neutral-400">{new Date(r.ts).toLocaleString("en-GB")}</span>
                    <span className="text-neutral-300 group-open:hidden">▸</span>
                    <span className="hidden text-neutral-300 group-open:inline">▾</span>
                  </summary>

                  {p.subject && (
                    <div className="px-3 pb-1 text-sm text-neutral-700">
                      <span className="text-xs uppercase tracking-wide text-neutral-400">Subject: </span>
                      {p.subject}
                    </div>
                  )}

                  {/* Body — text preferred, falls back to html (rendered as text). */}
                  <div className="border-t border-neutral-100 px-3 py-3">
                    {body ? (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 font-sans text-sm text-neutral-800">
                        {body.slice(0, 8000)}
                        {body.length > 8000 && <span className="text-neutral-400">… (truncated)</span>}
                      </pre>
                    ) : (
                      <p className="text-sm italic text-neutral-400">No body captured (webhook from old format).</p>
                    )}
                    {sig && (sig.mobile || sig.job_title || sig.linkedin_url) && (
                      <div className="mt-2 rounded border border-emerald-100 bg-emerald-50/50 p-2 text-xs text-emerald-900">
                        <span className="font-medium">Parsed signature:</span>
                        {sig.mobile && <span className="ml-2">📱 {sig.mobile}</span>}
                        {sig.job_title && <span className="ml-2">💼 {sig.job_title}</span>}
                        {sig.linkedin_url && <span className="ml-2">in: <a href={sig.linkedin_url} target="_blank" rel="noreferrer" className="underline">{sig.linkedin_url}</a></span>}
                      </div>
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 bg-neutral-50/70 p-3 text-sm">
                    {r.contact ? (
                      <Link href={`/contacts/${r.contact.id}`} className="text-blue-700 hover:underline">
                        → Open contact
                      </Link>
                    ) : (
                      <>
                        {/* Assign to existing contact */}
                        <form action={assignReplyToContactAction} className="flex flex-wrap items-end gap-1">
                          <input type="hidden" name="event_id" value={r.id} />
                          <div className="min-w-[16rem]">
                            <Combobox name="contact_id" options={contactOptions} placeholder="Assign to existing contact…" required />
                          </div>
                          <PendingButton
                            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            pendingLabel="Assigning…"
                          >
                            Assign
                          </PendingButton>
                        </form>

                        <span className="text-xs text-neutral-400">or</span>

                        {/* Create a new contact from the sender */}
                        <details className="rounded border border-neutral-200 bg-white p-2 text-xs">
                          <summary className="cursor-pointer text-neutral-700">+ Create new contact from {p.from}</summary>
                          <form action={createContactFromReplyAction} className="mt-2 flex flex-wrap items-end gap-1">
                            <input type="hidden" name="event_id" value={r.id} />
                            <input
                              name="full_name"
                              defaultValue={p.from_name ?? ""}
                              placeholder="Full name"
                              className="rounded border border-neutral-300 px-2 py-1 text-xs"
                              required
                            />
                            <div className="min-w-[14rem]">
                              <Combobox
                                name="organisation_id"
                                options={orgOptions}
                                placeholder="Existing company (optional)…"
                              />
                            </div>
                            <input
                              name="new_org_name"
                              placeholder="…or new company name"
                              className="rounded border border-neutral-300 px-2 py-1 text-xs"
                            />
                            <PendingButton
                              className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              pendingLabel="Creating…"
                            >
                              Create + assign
                            </PendingButton>
                          </form>
                        </details>
                      </>
                    )}

                    <form action={dismissReplyAction} className="ml-auto">
                      <input type="hidden" name="event_id" value={r.id} />
                      <PendingButton
                        className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                        pendingLabel="…"
                      >
                        Dismiss
                      </PendingButton>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

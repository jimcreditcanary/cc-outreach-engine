import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateNewsletter, deleteNewsletter, sendNewsletter } from "../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";
import { textToHtml } from "@/lib/generate/render";
import { unsubFooterHtml } from "@/lib/generate/config";
import { resolveSender, signatureHtml } from "@/lib/generate/sender";
import { currentUserId } from "@/lib/auth/owner";
import { fmtDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";
// Send loops over every subscriber — give it runway.
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

export default async function NewsletterIssue({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  const db = serviceClient();

  const [{ data: issue }, { count: subs }] = await Promise.all([
    db.from("newsletters").select("*").eq("id", id).maybeSingle(),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("newsletter_subscribed", true),
  ]);
  if (!issue) notFound();
  const isSent = issue.status === "sent";

  // Analytics — only worth fetching after the issue has gone out. Aggregates
  // every open/click/bounce/unsubscribe event tagged with this newsletter_id.
  interface RecipientStats {
    contact_id: string;
    full_name: string | null;
    email: string | null;
    opens: number;
    clicks: number;
    bounced: boolean;
    unsubscribed: boolean;
  }
  let recipients: RecipientStats[] = [];
  let totals = { sent: 0, opens: 0, clicks: 0, uniqueOpens: 0, uniqueClicks: 0, bounces: 0, unsubs: 0 };
  if (isSent) {
    // Sent events for this issue → the recipient list + their contact ids.
    const { data: sentEvents } = await db
      .from("events")
      .select("contact_id, contact:contacts(full_name, email)")
      .eq("type", "email_sent")
      .eq("source", "newsletter")
      .eq("payload->>newsletter_id", id);
    const sentArr = (sentEvents ?? []) as unknown as { contact_id: string; contact: { full_name: string | null; email: string | null } | null }[];
    const byContact = new Map<string, RecipientStats>();
    for (const r of sentArr) {
      if (!byContact.has(r.contact_id)) {
        byContact.set(r.contact_id, {
          contact_id: r.contact_id,
          full_name: r.contact?.full_name ?? null,
          email: r.contact?.email ?? null,
          opens: 0, clicks: 0, bounced: false, unsubscribed: false,
        });
      }
    }

    const { data: actionEvents } = await db
      .from("events")
      .select("contact_id, type")
      .in("type", ["open", "click", "bounce", "unsubscribe"])
      .eq("payload->>newsletter_id", id)
      .in("contact_id", Array.from(byContact.keys()).length ? Array.from(byContact.keys()) : ["__none__"]);
    for (const e of actionEvents ?? []) {
      const r = byContact.get(e.contact_id as string);
      if (!r) continue;
      if (e.type === "open") r.opens++;
      else if (e.type === "click") r.clicks++;
      else if (e.type === "bounce") r.bounced = true;
      else if (e.type === "unsubscribe") r.unsubscribed = true;
    }

    recipients = Array.from(byContact.values()).sort((a, b) => (b.clicks + b.opens) - (a.clicks + a.opens));
    totals = {
      sent: recipients.length,
      opens: recipients.reduce((s, r) => s + r.opens, 0),
      clicks: recipients.reduce((s, r) => s + r.clicks, 0),
      uniqueOpens: recipients.filter((r) => r.opens > 0).length,
      uniqueClicks: recipients.filter((r) => r.clicks > 0).length,
      bounces: recipients.filter((r) => r.bounced).length,
      unsubs: recipients.filter((r) => r.unsubscribed).length,
    };
  }
  const pct = (n: number) => (totals.sent ? `${Math.round((n / totals.sent) * 100)}%` : "—");

  // Live preview HTML — signature reflects the signed-in operator so
  // they see exactly what'll go out.
  const previewSender = await resolveSender(db, await currentUserId());
  const previewHtml = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${textToHtml(issue.body_text ?? "")}
${signatureHtml(previewSender)}
${unsubFooterHtml("recipient@example.com")}
</div>`;

  return (
    <main className="px-8 py-6">
      <Link href="/newsletter" className="text-sm text-blue-700 hover:underline">← Newsletter</Link>
      <header className="mb-4 mt-2 flex flex-wrap items-baseline gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">{issue.subject}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${isSent ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-700"}`}>
          {issue.status}
        </span>
        {isSent && (
          <span className="text-sm text-neutral-500">
            Sent to {issue.sent_count} on {fmtDateTime(issue.sent_at)}
          </span>
        )}
        {!isSent && <span className="ml-auto text-sm text-neutral-500">{subs ?? 0} subscriber{subs === 1 ? "" : "s"} ready</span>}
      </header>

      {!isSent ? (
        <form action={updateNewsletter} className="space-y-3">
          <input type="hidden" name="id" value={issue.id} />
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Subject</label>
            <input name="subject" defaultValue={issue.subject} className={`${field} font-medium`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Body (plain prose, separate paragraphs with blank lines, URLs auto-link)
            </label>
            <textarea name="body_text" defaultValue={issue.body_text ?? ""} rows={20} className={`${field} font-sans leading-relaxed`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <PendingButton className="rounded bg-neutral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800" pendingLabel="Saving…">
              Save
            </PendingButton>
            <Link href={`/newsletter/${id}?preview=1`} className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              {preview ? "Hide preview" : "Save then preview ↓"}
            </Link>
            <PendingButton
              formAction={sendNewsletter}
              className="ml-auto rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
              pendingLabel={`Sending to ${subs ?? 0}…`}
            >
              Send to {subs ?? 0} subscribers
            </PendingButton>
            <ConfirmSubmit
              formAction={deleteNewsletter}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              message={`Delete this draft "${issue.subject}"?`}
            >
              Delete
            </ConfirmSubmit>
          </div>
        </form>
      ) : (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          This issue has already been sent — no further edits.
        </div>
      )}

      {/* Analytics — only meaningful once the issue has shipped */}
      {isSent && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Analytics</h2>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Recipients" value={`${totals.sent}`} />
            <Stat label="Unique opens" value={`${totals.uniqueOpens}`} sub={`${pct(totals.uniqueOpens)} · ${totals.opens} total`} />
            <Stat label="Unique clicks" value={`${totals.uniqueClicks}`} sub={`${pct(totals.uniqueClicks)} · ${totals.clicks} total`} />
            <Stat label="Bounces · unsubs" value={`${totals.bounces} · ${totals.unsubs}`} sub={`${pct(totals.bounces)} bounce`} />
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            Opens are noisy (Apple/Gmail prefetch inflates them). Clicks are the real engagement signal.
          </p>
          {recipients.length > 0 && (
            <details className="rounded border border-neutral-200 bg-white p-3">
              <summary className="cursor-pointer text-sm text-neutral-600">Per-recipient breakdown ({recipients.length})</summary>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-neutral-400">
                  <tr><th className="py-1">Contact</th><th>Email</th><th className="text-right">Opens</th><th className="text-right">Clicks</th><th className="text-right">Status</th></tr>
                </thead>
                <tbody>
                  {recipients.map((r) => (
                    <tr key={r.contact_id} className="border-t border-neutral-100">
                      <td className="py-1.5">
                        <Link href={`/contacts/${r.contact_id}`} className="text-blue-700 hover:underline">{r.full_name ?? "(unnamed)"}</Link>
                      </td>
                      <td className="text-neutral-600">{r.email ?? "—"}</td>
                      <td className="text-right text-neutral-700">{r.opens || ""}</td>
                      <td className="text-right text-neutral-700">{r.clicks || ""}</td>
                      <td className="text-right">
                        {r.bounced && <span className="rounded bg-red-100 px-1.5 text-xs text-red-700">bounced</span>}
                        {r.unsubscribed && <span className="ml-1 rounded bg-neutral-200 px-1.5 text-xs text-neutral-700">unsub</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      {/* Preview */}
      {(preview || isSent) && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Preview (as a subscriber will see it)</h2>
          <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="mb-3 border-b border-neutral-100 pb-2 text-sm text-neutral-500">
              <span className="font-medium">Subject:</span> {issue.subject}
            </div>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-neutral-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}

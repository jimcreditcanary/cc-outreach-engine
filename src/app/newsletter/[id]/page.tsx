import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateNewsletter, deleteNewsletter, sendNewsletter } from "../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";
import { textToHtml } from "@/lib/generate/render";
import { SIGNATURE_HTML, unsubFooterHtml } from "@/lib/generate/config";

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

  // Live preview HTML (uses current saved body_text; for live preview as
  // they type, they'd Save first — keeps things simple + accurate).
  const previewHtml = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${textToHtml(issue.body_text ?? "")}
${SIGNATURE_HTML}
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
            Sent to {issue.sent_count} on {new Date(issue.sent_at).toLocaleString("en-GB")}
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

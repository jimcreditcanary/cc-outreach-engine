// Parse a Granola "share via email" payload into the bits we need to
// match it to a meeting + write the transcript. Granola's share format
// has shifted a few times — we accept a few common shapes:
//
//   Subject patterns:
//     "Notes: <meeting title>"
//     "Granola notes — <meeting title>"
//     "<meeting title>"   (some accounts strip the prefix)
//
//   Body sections (markdown-ish):
//     # <title>
//     **<date>** at **<time>**
//     ## Attendees / Summary / Action Items / Transcript
//
// We only need (a) a probable meeting title for matching and (b) the
// transcript. Everything else is a bonus.

export interface ParsedGranolaEmail {
  /** Title used for fuzzy meeting match (subject minus the Notes/Granola
   *  prefix when present). */
  meeting_title: string;
  /** ISO timestamp if Granola embedded a date in the body, else null. */
  meeting_started_at: string | null;
  /** Transcript text. Empty when Granola hasn't included one
   *  (some "share" configurations only send summary). */
  transcript: string;
  /** Granola's own summary (fallback when we can't run our own AI). */
  granola_summary: string | null;
}

const SUBJECT_PREFIX = /^(notes?\s*[:\-—]|granola\s*notes?\s*[:\-—])\s*/i;

/** Try to find a transcript block in the email body. Granola's share emails
 *  typically use a "## Transcript" or "Transcript:" header before a long
 *  block of speaker-prefixed lines. Fallback: just take the whole body. */
function pluck(body: string, label: RegExp, stopLabels: RegExp[]): string | null {
  const m = label.exec(body);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  let endIdx = body.length;
  for (const stop of stopLabels) {
    stop.lastIndex = startIdx;
    const s = stop.exec(body);
    if (s && s.index < endIdx) endIdx = s.index;
  }
  return body.slice(startIdx, endIdx).trim();
}

/** Try ISO / "Mon 5 Jun 2026, 12:00" / similar. Returns null when nothing
 *  parses. Permissive — we'd rather have null than a wrong date. */
function pluckDate(body: string): string | null {
  // Try an ISO timestamp first.
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+\-]\d{2}:?\d{2})?)\b/.exec(body);
  if (iso?.[1]) {
    const d = new Date(iso[1]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // Try "DD Mon YYYY, HH:MM" (Granola's default-locale format).
  const mFmt = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}).{0,20}?(\d{1,2}[:.]\d{2})/i.exec(body);
  if (mFmt?.[1] && mFmt?.[2]) {
    const d = new Date(`${mFmt[1]} ${mFmt[2].replace(".", ":")}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function parseGranolaEmail(opts: { subject: string; text_body: string; html_body?: string | null }): ParsedGranolaEmail {
  const subject = (opts.subject ?? "").trim();
  const text = (opts.text_body ?? "").trim();
  const meeting_title = subject.replace(SUBJECT_PREFIX, "").trim() || subject;

  const transcript =
    pluck(text, /(?:^|\n)\s*(?:#{1,3}\s*)?transcript\s*[:\n]/i, [/\n\s*(?:#{1,3}\s*)?(attendees|action items?|summary|key points|key takeaways|notes)\b/i])
    // Granola sometimes labels it "Verbatim" instead.
    ?? pluck(text, /(?:^|\n)\s*(?:#{1,3}\s*)?verbatim\s*[:\n]/i, [/\n\s*#{1,3}\s/])
    // Fallback: anything that looks like speaker-tagged dialogue.
    ?? (/^\s*[A-Z][A-Za-z .'-]{1,40}:\s/m.test(text) ? text : "");

  const summary =
    pluck(text, /(?:^|\n)\s*(?:#{1,3}\s*)?(?:summary|key takeaways|key points|tldr)\s*[:\n]/i, [/\n\s*(?:#{1,3}\s*)?(transcript|verbatim|action items?|attendees)\b/i])
    ?? null;

  return {
    meeting_title,
    meeting_started_at: pluckDate(text),
    transcript: transcript.trim(),
    granola_summary: summary?.trim() ?? null,
  };
}

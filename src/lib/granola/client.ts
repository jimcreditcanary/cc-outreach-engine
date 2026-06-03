// Granola public-API wrapper. Bearer-token auth against api.granola.ai.
// Per-user token comes out of user_settings.granola_api_token (set by
// the operator under /settings → Granola section).
//
// API shape note: Granola's public API is in active beta. The endpoints
// + response shapes below match their documented v2 surface as of mid
// 2026 (POST /v2/get-documents{,-with-transcript}). If they shift, this
// is the ONE file to retune — everything downstream takes the normalised
// GranolaNote shape.

const BASE = process.env.GRANOLA_API_BASE ?? "https://api.granola.ai";

/** Normalised shape we use everywhere downstream. */
export interface GranolaNote {
  id: string;
  title: string | null;
  /** When the meeting actually started (not when the note was created). */
  started_at: string | null;
  /** Email addresses of attendees as Granola records them. Used to match
   *  back to our meetings.attendees / primary_contact. */
  attendee_emails: string[];
  /** Raw transcript text. Empty / null when Granola hasn't finished
   *  processing yet — caller should skip and retry next tick. */
  transcript: string | null;
  /** Granola's own summary, if present. We don't ship this directly —
   *  we re-summarise via Claude — but useful for fallback / debugging. */
  granola_summary: string | null;
}

interface GranolaListResponse {
  documents?: Array<{
    id: string;
    title?: string | null;
    /** ISO timestamp of the meeting start. Several field names seen in
     *  the wild — we coalesce them in normaliseNote. */
    meeting_start_time?: string | null;
    created_at?: string | null;
    start_time?: string | null;
    attendees?: Array<{ email?: string | null }> | null;
    people?: Array<{ email?: string | null }> | null;
  }>;
}

interface GranolaDocResponse {
  id: string;
  title?: string | null;
  meeting_start_time?: string | null;
  created_at?: string | null;
  start_time?: string | null;
  attendees?: Array<{ email?: string | null }> | null;
  people?: Array<{ email?: string | null }> | null;
  transcript?: string | null;
  /** Long-form notes Granola generated. Some accounts get this as
   *  `notes_markdown`, others as `summary`. */
  notes_markdown?: string | null;
  summary?: string | null;
}

function normaliseNote(d: GranolaDocResponse): GranolaNote {
  const started =
    d.meeting_start_time ?? d.start_time ?? d.created_at ?? null;
  const emails = [...(d.attendees ?? []), ...(d.people ?? [])]
    .map((a) => (a?.email ?? "").trim().toLowerCase())
    .filter(Boolean);
  return {
    id: d.id,
    title: d.title ?? null,
    started_at: started,
    attendee_emails: Array.from(new Set(emails)),
    transcript: d.transcript ?? null,
    granola_summary: d.notes_markdown ?? d.summary ?? null,
  };
}

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify(body),
    // Granola's API is sometimes slow when transcribing — short timeout
    // would just trigger retries that hammer their side.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Granola ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** List notes the operator has in Granola. We don't filter by date here —
 *  matching happens by exact start_time on the caller side. Granola caps
 *  the page implicitly; we ask for the most recent window. */
export async function listNotes(token: string, opts: { sinceISO?: string } = {}): Promise<GranolaNote[]> {
  const resp = await call<GranolaListResponse>(token, "/v2/get-documents", {
    limit: 100,
    // Granola accepts a "since" filter on most endpoints. Pass it when
    // we have one to keep the payload small after the first poll.
    ...(opts.sinceISO ? { since: opts.sinceISO } : {}),
  });
  return (resp.documents ?? []).map((d) =>
    // Reuse the doc-response normaliser even for list rows; transcript
    // will be null at this stage, that's expected.
    normaliseNote(d as GranolaDocResponse),
  );
}

/** Pull one full note WITH transcript. Granola's transcript endpoint
 *  returns null until processing is complete — caller should treat that
 *  as "try again next tick". */
export async function getNoteWithTranscript(token: string, noteId: string): Promise<GranolaNote> {
  const resp = await call<GranolaDocResponse>(
    token,
    "/v2/get-document-with-content",
    { document_id: noteId, include_transcript: true },
  );
  return normaliseNote(resp);
}

/** Belt-and-braces auth check — used by /settings to confirm the token
 *  is valid before saving. We hit the lightest endpoint we know about. */
export async function pingToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await call<GranolaListResponse>(token, "/v2/get-documents", { limit: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

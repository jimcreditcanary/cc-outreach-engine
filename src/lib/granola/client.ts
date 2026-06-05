// Granola public-API wrapper. Implements the documented surface:
// https://docs.granola.ai/api-reference/list-notes
// https://docs.granola.ai/api-reference/get-note
//
//   Base:   https://public-api.granola.ai
//   Auth:   Authorization: Bearer <key>
//   List:   GET /v1/notes?page_size=N&created_after=...&cursor=...
//   Single: GET /v1/notes/{id}
//
// Issue a key at granola.ai → workspace → API. Tick BOTH "Personal notes"
// AND "Public notes" so the key sees Team Space notes.
//
// Rate limit (per docs): 5 req/sec sustained — sync stays well under.

const BASE = process.env.GRANOLA_API_BASE ?? "https://public-api.granola.ai";

// ── Normalised shape we use downstream ──────────────────────────────
export interface GranolaNote {
  id: string;
  title: string | null;
  /** When the meeting actually started (from calendar_event), else the
   *  note's created_at as a fallback. */
  started_at: string | null;
  /** Source-calendar event id (Microsoft Graph / Google). Primary match
   *  key against meetings.ms_event_id — exact, not fuzzy. */
  calendar_event_id: string | null;
  /** Attendee emails (deduped, lowercased). Fallback match key. */
  attendee_emails: string[];
  /** Transcript joined to a single speaker-tagged string. null when
   *  Granola hasn't finished processing yet. */
  transcript: string | null;
  /** Granola's AI summary. Used as fallback ground for the outbound
   *  follow-up when our own re-summarisation is empty. */
  granola_summary: string | null;
}

// ── Raw API shapes (from the OpenAPI schema) ───────────────────────
interface NoteSummary {
  id: string;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner?: { name?: string | null; email?: string } | null;
}

interface CalendarEvent {
  event_title?: string | null;
  calendar_event_id?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  invitees?: Array<{ email?: string | null }> | null;
  organiser?: string | null;
}

interface TranscriptChunk {
  speaker?: { source?: string; name?: string | null; diarization_label?: string | null } | null;
  text?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

interface NoteDetail extends NoteSummary {
  web_url?: string | null;
  calendar_event?: CalendarEvent | null;
  attendees?: Array<{ name?: string | null; email?: string | null }> | null;
  summary_text?: string | null;
  summary_markdown?: string | null;
  transcript?: TranscriptChunk[] | null;
}

interface ListNotesResponse {
  notes: NoteSummary[];
  hasMore: boolean;
  cursor: string | null;
}

// ── HTTP plumbing ──────────────────────────────────────────────────
async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Granola GET ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ── Normalisers ────────────────────────────────────────────────────
function normaliseFromList(d: NoteSummary): GranolaNote {
  return {
    id: d.id,
    title: d.title ?? null,
    started_at: d.created_at ?? null, // best-effort; detail call refines
    calendar_event_id: null,
    attendee_emails: [],
    transcript: null,
    granola_summary: null,
  };
}

/** Flatten the transcript array into a single speaker-tagged string so
 *  the rest of our pipeline (post-summary, follow-up) can treat it like
 *  any other transcript. Per chunk: prefer speaker.name → diarization
 *  label → no tag. */
function joinTranscript(chunks: TranscriptChunk[] | null | undefined): string | null {
  if (!chunks || chunks.length === 0) return null;
  const lines: string[] = [];
  for (const c of chunks) {
    const txt = (c?.text ?? "").trim();
    if (!txt) continue;
    const name = c?.speaker?.name?.trim() || null;
    const label = c?.speaker?.diarization_label?.trim() || null;
    const tag = name || label;
    lines.push(tag ? `${tag}: ${txt}` : txt);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function normaliseFromDetail(d: NoteDetail): GranolaNote {
  const cal = d.calendar_event ?? null;
  const emails = new Set<string>();
  for (const a of d.attendees ?? []) {
    const e = (a?.email ?? "").trim().toLowerCase();
    if (e.includes("@")) emails.add(e);
  }
  for (const i of cal?.invitees ?? []) {
    const e = (i?.email ?? "").trim().toLowerCase();
    if (e.includes("@")) emails.add(e);
  }
  return {
    id: d.id,
    title: d.title ?? null,
    started_at: cal?.scheduled_start_time ?? d.created_at ?? null,
    calendar_event_id: cal?.calendar_event_id ?? null,
    attendee_emails: Array.from(emails),
    transcript: joinTranscript(d.transcript),
    granola_summary: d.summary_markdown ?? d.summary_text ?? null,
  };
}

// ── Public API ─────────────────────────────────────────────────────

/** List notes. `page_size` is capped at 30 by Granola; defaults to 30
 *  here (their default is 10). `createdAfter` / `updatedAfter` filter
 *  server-side — much cheaper than fetching all and filtering locally.
 *  Returns shallow stubs (no calendar/attendees/transcript) — call
 *  getNoteWithTranscript(id) for the full record. */
export async function listNotes(
  token: string,
  opts: { pageSize?: number; createdAfter?: string; updatedAfter?: string; cursor?: string } = {},
): Promise<{ notes: GranolaNote[]; hasMore: boolean; cursor: string | null }> {
  const qs = new URLSearchParams();
  qs.set("page_size", String(Math.min(opts.pageSize ?? 30, 30)));
  if (opts.createdAfter) qs.set("created_after", opts.createdAfter);
  if (opts.updatedAfter) qs.set("updated_after", opts.updatedAfter);
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const resp = await get<ListNotesResponse>(token, `/v1/notes?${qs.toString()}`);
  return {
    notes: (resp.notes ?? []).map(normaliseFromList),
    hasMore: !!resp.hasMore,
    cursor: resp.cursor ?? null,
  };
}

/** Fetch one full note (calendar event, attendees, summary, transcript).
 *  transcript is null until Granola finishes processing. */
export async function getNoteWithTranscript(token: string, noteId: string): Promise<GranolaNote> {
  const resp = await get<NoteDetail>(token, `/v1/notes/${encodeURIComponent(noteId)}`);
  return normaliseFromDetail(resp);
}

/** Validate a token before saving — used by /settings's "Connect" form. */
export async function pingToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await get<ListNotesResponse>(token, `/v1/notes?page_size=1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

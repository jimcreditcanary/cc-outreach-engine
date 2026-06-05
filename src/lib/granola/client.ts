// Granola public-API wrapper.
//
// Real public API (NOT the Electron-app's internal /v2/* endpoints,
// which gate on a special client header — confirmed by probing):
//
//   Base:     https://public-api.granola.ai
//   Auth:     Authorization: Bearer <key>
//   List:     GET /v1/notes?limit=N
//   Single:   GET /v1/notes/{id}   (returns transcript + summary + calendar)
//
// Issue your key at granola.ai → workspace settings → API. Tick BOTH
// "Personal notes" AND "Public notes" so the key sees Team Space notes.
//
// One key = one workspace (the user who issued it). For multi-user
// CRMs each operator pastes their own key under /settings → Granola;
// the sync engine iterates over user_settings.granola_api_token rows.

const BASE = process.env.GRANOLA_API_BASE ?? "https://public-api.granola.ai";

/** Normalised shape we use everywhere downstream. */
export interface GranolaNote {
  id: string;
  title: string | null;
  /** When the meeting actually started (not when the note was created). */
  started_at: string | null;
  /** Source-calendar event id (Microsoft Graph / Google). When present
   *  this is the PRIMARY match key against meetings.ms_event_id —
   *  exact, not fuzzy. */
  calendar_event_id: string | null;
  /** Attendee emails (deduped, lowercased). Used as a fallback match
   *  when calendar_event_id isn't surfaced. */
  attendee_emails: string[];
  /** Raw transcript text. null until Granola finishes transcribing —
   *  caller should treat as "try again next tick". */
  transcript: string | null;
  /** Granola's AI-generated summary. We don't ship this directly to
   *  the contact (we re-summarise via Claude) but use it as fallback
   *  when our own summary fails. */
  granola_summary: string | null;
}

interface GranolaListResponse {
  notes?: Array<{ id: string; title?: string | null; created_at?: string | null; updated_at?: string | null }>;
}

interface GranolaNoteResponse {
  id: string;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  transcript?: string | null;
  summary_text?: string | null;
  attendees?: Array<{ name?: string | null; email?: string | null }> | null;
  calendar_event?: {
    event_title?: string | null;
    calendar_event_id?: string | null;
    scheduled_start_time?: string | null;
    scheduled_end_time?: string | null;
    invitees?: Array<{ email?: string | null }> | null;
    organiser?: string | null;
  } | null;
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Granola GET ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface GranolaListItem {
  id: string;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function normaliseFromList(d: GranolaListItem): GranolaNote {
  // List view doesn't include calendar/attendees/transcript — those come
  // on the GET /v1/notes/{id} pass. Return a stub the caller can fatten.
  return {
    id: d.id,
    title: d.title ?? null,
    started_at: d.created_at ?? null,
    calendar_event_id: null,
    attendee_emails: [],
    transcript: null,
    granola_summary: null,
  };
}

function normaliseFromDetail(d: GranolaNoteResponse): GranolaNote {
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
    transcript: d.transcript ?? null,
    granola_summary: d.summary_text ?? null,
  };
}

/** List the workspace's notes (newest first). Returns shallow stubs —
 *  call getNoteWithTranscript(id) for the full record + transcript. */
export async function listNotes(token: string, opts: { limit?: number } = {}): Promise<GranolaNote[]> {
  const limit = opts.limit ?? 50;
  const resp = await get<GranolaListResponse>(token, `/v1/notes?limit=${limit}`);
  return (resp.notes ?? []).map((n) => normaliseFromList(n as GranolaListItem));
}

/** Fetch one full note (calendar event, attendees, summary, transcript).
 *  transcript is null until Granola finishes processing — caller polls. */
export async function getNoteWithTranscript(token: string, noteId: string): Promise<GranolaNote> {
  const resp = await get<GranolaNoteResponse>(token, `/v1/notes/${encodeURIComponent(noteId)}`);
  return normaliseFromDetail(resp);
}

/** Validate a token before saving — used by /settings's "Connect" form. */
export async function pingToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await get<GranolaListResponse>(token, `/v1/notes?limit=1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

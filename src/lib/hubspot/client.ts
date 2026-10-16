// Low-level HubSpot CRM v3/v4 REST client. Lean raw-fetch wrapper (no SDK
// dependency), mirroring the house style of postmark.ts: env-driven, graceful
// when the token is unset, all transport concerns (auth, JSON, rate-limit
// retry, read-through cache) live here so the repository layer stays pure.
//
// AUTH: a HubSpot Private App token in `HUBSPOT_TOKEN` (pat-eu1-…). Unset =
// "not configured" — hubspotEnabled() is false and callers can fall back.
//
// Portal: Fumopay Ltd (9175484), EU1. Record-view URLs use app-eu1.hubspot.com.

const BASE = "https://api.hubapi.com";

export const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "9175484";
const UI_DOMAIN = process.env.HUBSPOT_UI_DOMAIN ?? "https://app-eu1.hubspot.com";

/** Object-type number used in HubSpot record URLs. */
const OBJECT_TYPE_PREFIX: Record<string, string> = { contacts: "0-1", companies: "0-2", deals: "0-3" };

export function hubspotToken(): string | undefined {
  return process.env.HUBSPOT_TOKEN ?? process.env.HUBSPOT_ACCESS_TOKEN;
}

export function hubspotEnabled(): boolean {
  return !!hubspotToken();
}

/** A HubSpot record's web URL, for linking out from the console. */
export function recordUrl(objectType: string, id: string): string {
  const prefix = OBJECT_TYPE_PREFIX[objectType] ?? "0-1";
  return `${UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/${prefix}/${id}`;
}

export class HubSpotError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "HubSpotError";
  }
}

// ── read-through cache (live + short TTL) ───────────────────────────────
// In-memory, per-process. On Vercel each lambda instance has its own, so this
// only coalesces reads within a warm instance — enough to take the edge off
// repeated list/detail reads. Durable/shared caching is the later mirror.
const DEFAULT_TTL = Number(process.env.HUBSPOT_CACHE_TTL_MS ?? 15_000);
const cache = new Map<string, { exp: number; val: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { cache.delete(key); return undefined; }
  return hit.val as T;
}
function cacheSet(key: string, val: unknown, ttl: number): void {
  cache.set(key, { exp: Date.now() + ttl, val });
}

/** Drop cached reads (call after a write so the next read is fresh). */
export function invalidateCache(): void {
  cache.clear();
}

interface FetchOpts {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Cache this response for N ms (reads only). 0/undefined = no cache. */
  cacheTtl?: number;
  /** Max 429 retries (default 3). */
  retries?: number;
}

/** Core request: auth, JSON, 429 back-off honouring Retry-After, typed throw. */
export async function hsFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = hubspotToken();
  if (!token) throw new HubSpotError(0, "HUBSPOT_TOKEN is not set — HubSpot is not configured.");

  const { method = "GET", body, cacheTtl, retries = 3 } = opts;
  const cacheKey = cacheTtl ? `${method} ${path} ${body ? JSON.stringify(body) : ""}` : null;
  if (cacheKey) {
    const cached = cacheGet<T>(cacheKey);
    if (cached !== undefined) return cached;
  }

  let attempt = 0;
  for (;;) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }

    const text = await res.text();
    const json = text ? safeParse(text) : null;
    if (!res.ok) {
      const msg = (json as { message?: string } | null)?.message ?? `HubSpot ${method} ${path} failed (${res.status})`;
      throw new HubSpotError(res.status, msg, json);
    }
    const val = json as T;
    if (cacheKey) cacheSet(cacheKey, val, cacheTtl!);
    return val;
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

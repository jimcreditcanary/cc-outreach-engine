// Microsoft Graph OAuth 2.0 (authorization code + refresh). Standard endpoints,
// no SDK — just fetch. Tokens stored in ms_oauth_tokens keyed by Supabase user
// id so the calendar binding is per-operator (today only Jim has one).

import { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

const AUTH_BASE = "https://login.microsoftonline.com";
// Calendars.ReadWrite (was .Read) so booking-page events can be written
// straight into the operator's calendar. Applies to NEW connects; existing
// tokens keep their original grant (refresh deliberately omits scope below)
// and event creation 403s → the caller falls back to emailed ICS invites
// until the operator reconnects.
export const MS_SCOPES = ["openid", "offline_access", "Calendars.ReadWrite", "User.Read"];

function tenant(): string {
  return process.env.MS_TENANT_ID || "common";
}

function clientId(): string {
  const v = process.env.MS_CLIENT_ID;
  if (!v) throw new Error("Missing MS_CLIENT_ID");
  return v;
}

function clientSecret(): string {
  const v = process.env.MS_CLIENT_SECRET;
  if (!v) throw new Error("Missing MS_CLIENT_SECRET");
  return v;
}

function redirectUri(): string {
  const v = process.env.MS_REDIRECT_URI;
  if (!v) throw new Error("Missing MS_REDIRECT_URI");
  return v;
}

/** Build the authorise URL we redirect Jim's browser to. */
export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: MS_SCOPES.join(" "),
    response_mode: "query",
    state,
    prompt: "select_account",
  });
  return `${AUTH_BASE}/${tenant()}/oauth2/v2.0/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_BASE}/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MS token call failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

/** Exchange the auth code returned to /callback for an access + refresh token. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      scope: MS_SCOPES.join(" "),
    }),
  );
}

/** Use the stored refresh token to mint a fresh access token. No scope
 *  param on purpose: Microsoft then re-issues whatever was originally
 *  consented. Sending the (now wider) MS_SCOPES here would fail refreshes
 *  for tokens granted under the old read-only scope and break the hourly
 *  calendar sync until everyone reconnected. */
export async function refreshAccessToken(refresh_token: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token,
      grant_type: "refresh_token",
    }),
  );
}

/** Persist a fresh token bundle for a user. */
export async function saveTokens(db: DB, userId: string, t: TokenResponse): Promise<void> {
  const expires_at = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(); // 60s safety margin
  const { error } = await db.from("ms_oauth_tokens").upsert(
    {
      user_id: userId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at,
      scope: t.scope ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

/** Return a valid access token for the user, refreshing if it's about to expire.
 *  Returns null if the user hasn't connected their Microsoft account yet. */
export async function getValidAccessToken(db: DB, userId: string): Promise<string | null> {
  const { data: row } = await db
    .from("ms_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() < expiresAt) return row.access_token as string;

  // Expired — refresh.
  const fresh = await refreshAccessToken(row.refresh_token as string);
  await saveTokens(db, userId, fresh);
  return fresh.access_token;
}

/** Has the user connected their Microsoft calendar at all? */
export async function isConnected(db: DB, userId: string): Promise<boolean> {
  const { data } = await db.from("ms_oauth_tokens").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

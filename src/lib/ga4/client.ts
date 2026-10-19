// Minimal GA4 Data API client. Authenticates with the service-account JSON
// (GOOGLE_APPLICATION_CREDENTIALS_JSON) via a self-signed JWT → access token
// (no SDK dependency), then calls runReport. Used by the high-intent ingestion
// to see which contacts (cc_cid) visited the site.

import crypto from "node:crypto";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

export function ga4Enabled(): boolean {
  return !!(process.env.GA4_PROPERTY_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

function loadSA(): ServiceAccount {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not set");
  const sa = JSON.parse(raw) as ServiceAccount;
  sa.private_key = sa.private_key.replace(/\\n/g, "\n"); // tolerate double-escaped keys
  return sa;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = loadSA();
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const payload = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: tokenUri, iat: now, exp: now + 3600,
  }))}`;
  const sig = crypto.createSign("RSA-SHA256").update(payload).sign(sa.private_key).toString("base64url");
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${payload}.${sig}` }),
  });
  if (!res.ok) throw new Error(`GA4 token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export interface Ga4Row { dimensionValues: { value: string }[]; metricValues: { value: string }[] }

export async function runReport(body: unknown): Promise<Ga4Row[]> {
  const pid = process.env.GA4_PROPERTY_ID;
  const token = await accessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { rows?: Ga4Row[] };
  return j.rows ?? [];
}

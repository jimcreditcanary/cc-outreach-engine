// Google Drive adapter — files an onboarding case's generated documents into a
// per-case folder structure. Reuses the service-account JWT→access-token pattern
// from the GA4 client (no SDK dependency), with the Drive scope. Fixture mock
// until a service account + root folder are configured, so the flow runs
// end-to-end meanwhile.
//
// Env (live): a service account (GOOGLE_SERVICE_ACCOUNT_JSON preferred, else the
// existing GOOGLE_APPLICATION_CREDENTIALS_JSON / _CREDENTIALS) WITH Drive access,
// plus ONBOARDING_DRIVE_ROOT_FOLDER_ID (shared with the service account).

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { useMock } from "./mock";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SCOPE = "https://www.googleapis.com/auth/drive";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

function rootFolderId(): string | undefined {
  return process.env.ONBOARDING_DRIVE_ROOT_FOLDER_ID?.trim() || undefined;
}
function hasCreds(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) && !!rootFolderId();
}

function loadSA(): ServiceAccount {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!raw && path) {
    try { raw = readFileSync(path, "utf8"); } catch { throw new Error(`GOOGLE_APPLICATION_CREDENTIALS not readable: ${path}`); }
  }
  if (raw && !raw.startsWith("{")) {
    try { raw = Buffer.from(raw, "base64").toString("utf8"); } catch { /* raw json */ }
  }
  if (!raw) throw new Error("No Google service account set (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS[_JSON]).");
  const sa = JSON.parse(raw) as ServiceAccount;
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = loadSA();
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const payload = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  const sig = crypto.createSign("RSA-SHA256").update(payload).sign(sa.private_key).toString("base64url");
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${payload}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Drive token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export interface DriveFolder { id: string; url: string }
export interface DriveFile { id: string; url: string }

export interface DriveClient {
  rootFolderId(): string;
  createFolder(name: string, parentId: string): Promise<DriveFolder>;
  uploadFile(input: { name: string; parentId: string; mimeType: string; bytes: Buffer }): Promise<DriveFile>;
}

function liveClient(): DriveClient {
  return {
    rootFolderId: () => rootFolderId()!,
    async createFolder(name, parentId) {
      const token = await accessToken();
      const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      if (!res.ok) throw new Error(`Drive createFolder failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { id: string; webViewLink?: string };
      return { id: j.id, url: j.webViewLink ?? `https://drive.google.com/drive/folders/${j.id}` };
    },
    async uploadFile({ name, parentId, mimeType, bytes }) {
      const token = await accessToken();
      const boundary = `cc-${crypto.randomUUID()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(body),
      });
      if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { id: string; webViewLink?: string };
      return { id: j.id, url: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view` };
    },
  };
}

function mockClient(): DriveClient {
  const fakeUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
  return {
    rootFolderId: () => rootFolderId() ?? "mock-root",
    async createFolder(name) {
      const id = `mock-${crypto.randomUUID()}`;
      return { id, url: fakeUrl(id) };
    },
    async uploadFile({ name }) {
      const id = `mock-${crypto.randomUUID()}`;
      return { id, url: `https://drive.google.com/file/d/${id}/view#${encodeURIComponent(name)}` };
    },
  };
}

export function driveConfigured(): boolean {
  return hasCreds();
}

export function getDrive(): DriveClient {
  return useMock("drive", hasCreds()) ? mockClient() : liveClient();
}

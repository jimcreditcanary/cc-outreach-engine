// Probe the Granola API directly. Used to verify whether a freshly-
// issued API key from Granola's "Edit API Key Access" dialog actually
// unlocks the public endpoints.
//
// Token resolution order:
//   1. env GRANOLA_API_TOKEN (recommended — paste into .env.local once)
//   2. user_settings.granola_api_token for Jim's user_id (legacy)
//
//   npx tsx scripts/probe-granola.ts

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BASE = process.env.GRANOLA_API_BASE ?? "https://api.granola.ai";

async function probe(label: string, token: string, path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  console.log(`\n── ${label}  POST ${path}`);
  console.log(`   body: ${JSON.stringify(body)}  extraHeaders: ${JSON.stringify(extraHeaders)}`);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        "accept": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    console.log(`   status: ${res.status}`);
    if (text.length > 0) {
      // Pretty-print if it looks like JSON, otherwise raw
      try {
        const json = JSON.parse(text);
        const preview = JSON.stringify(json, null, 2);
        console.log(`   body: ${preview.length > 2000 ? preview.slice(0, 2000) + "\n   …(truncated)" : preview}`);
      } catch {
        console.log(`   body (raw): ${text.slice(0, 800)}`);
      }
    } else {
      console.log(`   body: (empty)`);
    }
  } catch (e) {
    console.log(`   threw: ${(e as Error).message}`);
  }
}

(async () => {
  let token: string | undefined = process.env.GRANOLA_API_TOKEN;
  let source = "env GRANOLA_API_TOKEN";
  if (!token) {
    // Legacy fallback — user_settings.granola_api_token for Jim's id.
    const owner = "ccc221c6-57ec-45b3-b22e-09015454ffab";
    const { data } = await db.from("user_settings").select("granola_api_token").eq("user_id", owner).maybeSingle();
    token = (data?.granola_api_token as string | undefined) ?? undefined;
    source = "user_settings (Jim)";
  }
  if (!token) {
    console.error("no token — set GRANOLA_API_TOKEN in .env.local");
    process.exit(1);
  }
  console.log(`Token ending ${token.slice(-4)}  (source: ${source})`);

  // Search for the right endpoint. A fresh proper API key still gets
  // "Unsupported client" on /v2/get-documents — that path is the
  // Electron app's internal endpoint. The dashboard-issued key likely
  // targets a separate path or even a separate host.

  // Different paths on the same host
  await probe("v1 get-documents",    token, "/v1/get-documents", {});
  await probe("v2 notes",            token, "/v2/notes", {});
  await probe("v1 notes",            token, "/v1/notes", {});
  await probe("api v1 notes",        token, "/api/v1/notes", {});

  // REST-style GET variants (some API offerings use GET for list)
  console.log("\n── REST GET /v1/notes");
  try {
    const r = await fetch(`${BASE}/v1/notes`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    console.log(`   status: ${r.status}  body: ${(await r.text()).slice(0, 300)}`);
  } catch (e) { console.log(`   threw: ${(e as Error).message}`); }
  console.log("\n── REST GET /v1/documents");
  try {
    const r = await fetch(`${BASE}/v1/documents`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    console.log(`   status: ${r.status}  body: ${(await r.text()).slice(0, 300)}`);
  } catch (e) { console.log(`   threw: ${(e as Error).message}`); }

  // Different hostnames the key might target
  for (const host of ["https://api.granola.so", "https://public-api.granola.ai", "https://api.granola.ai/public"]) {
    console.log(`\n── host=${host}  GET /v1/notes`);
    try {
      const r = await fetch(`${host}/v1/notes`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      console.log(`   status: ${r.status}  body: ${(await r.text()).slice(0, 300)}`);
    } catch (e) { console.log(`   threw: ${(e as Error).message}`); }
  }

  // Different auth header conventions
  console.log("\n── X-API-Key header (instead of Bearer)");
  try {
    const r = await fetch(`${BASE}/v2/get-documents`, {
      method: "POST",
      headers: { "x-api-key": token, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ limit: 5 }),
      signal: AbortSignal.timeout(15000),
    });
    console.log(`   status: ${r.status}  body: ${(await r.text()).slice(0, 300)}`);
  } catch (e) { console.log(`   threw: ${(e as Error).message}`); }
})();

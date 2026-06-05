// Probe the Granola API directly with progressively-less-restricted
// params, dumping the raw response. Used to verify whether zero notes
// means "Granola has none" or "my client's request shape is wrong".
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
  // Jim is the meeting owner
  const owner = "ccc221c6-57ec-45b3-b22e-09015454ffab";
  const { data } = await db.from("user_settings").select("granola_api_token").eq("user_id", owner).maybeSingle();
  const token = data?.granola_api_token as string;
  if (!token) { console.error("no token"); process.exit(1); }
  console.log(`Token ending ${token.slice(-4)}`);

  // Try the endpoint with progressively more Granola-app-like headers
  const ua = "Granola/5.354.0 Electron/33.4.11";
  await probe("baseline",            token, "/v2/get-documents", { limit: 5 });
  await probe("UA only",             token, "/v2/get-documents", { limit: 5 }, { "user-agent": ua });
  await probe("UA + X-Client-Type",  token, "/v2/get-documents", { limit: 5 }, { "user-agent": ua, "x-client-type": "electron" });
  await probe("UA + Client headers", token, "/v2/get-documents", { limit: 5 }, {
    "user-agent": ua,
    "x-client-type": "electron",
    "x-client-platform": "darwin",
    "x-client-version": "5.354.0",
  });
})();

// Enrich contacts missing a job title by reading Google SERP results for
// their LinkedIn profile. We NEVER fetch linkedin.com — only the search
// engine's JSON (title/link/snippet). For each eligible contact:
//
//   query: site:linkedin.com/in "Full Name" Company
//   - top exact match (linkedin.com/in, name matches): lift job title +
//     store the profile URL.
//   - profile found but no title in the SERP: store the URL only.
//   - no match: mark not_on_linkedin = true.
//
// Eligible = job_title null, not_on_linkedin false, linkedin_url null,
// has full_name + company. That filter makes the run RESUMABLE: every
// outcome removes the contact from the next run, so re-running continues
// where it left off (safe to kill/restart).
//
//   npx tsx scripts/enrich-job-titles.ts --limit 10        # first batch
//   npx tsx scripts/enrich-job-titles.ts                    # the rest
//   npx tsx scripts/enrich-job-titles.ts --delay-sec 120    # pacing (default 120)
//   npx tsx scripts/enrich-job-titles.ts --dry-run --limit 10
//
// Provider auto-detected from env: SERPAPI_KEY (serpapi.com),
// SERPER_API_KEY (serper.dev), or GOOGLE_CSE_KEY + GOOGLE_CSE_CX.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildQuery, pickMatch, type SerpResult } from "../src/lib/contacts/serpJobTitle";

const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(argVal("--limit") ?? "0") || Infinity;
const DELAY_MS = (Number(argVal("--delay-sec") ?? "120") || 120) * 1000;
const DRY = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Search providers (whichever key is present) ──────────────────────
type Provider = (q: string) => Promise<SerpResult[]>;

function resolveProvider(): { name: string; search: Provider } {
  if (process.env.SERPAPI_KEY) {
    const key = process.env.SERPAPI_KEY;
    return {
      name: "serpapi",
      search: async (q) => {
        const u = new URL("https://serpapi.com/search.json");
        u.searchParams.set("engine", "google");
        u.searchParams.set("q", q);
        u.searchParams.set("num", "10");
        u.searchParams.set("gl", "uk");
        u.searchParams.set("hl", "en");
        u.searchParams.set("google_domain", "google.co.uk");
        u.searchParams.set("api_key", key);
        const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
        const j = (await res.json()) as { organic_results?: SerpResult[]; error?: string };
        if (j.error) throw new Error(`serpapi: ${j.error}`);
        return (j.organic_results ?? []).map((r) => ({ title: r.title, link: r.link, snippet: r.snippet, position: r.position }));
      },
    };
  }
  if (process.env.SERPER_API_KEY) {
    const key = process.env.SERPER_API_KEY;
    return {
      name: "serper",
      search: async (q) => {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/json" },
          body: JSON.stringify({ q, gl: "uk", num: 10 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`serper: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = (await res.json()) as { organic?: { title: string; link: string; snippet?: string; position?: number }[] };
        return (j.organic ?? []).map((r) => ({ title: r.title, link: r.link, snippet: r.snippet, position: r.position }));
      },
    };
  }
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) {
    const key = process.env.GOOGLE_CSE_KEY, cx = process.env.GOOGLE_CSE_CX;
    return {
      name: "google-cse",
      search: async (q) => {
        const u = new URL("https://www.googleapis.com/customsearch/v1");
        u.searchParams.set("key", key); u.searchParams.set("cx", cx); u.searchParams.set("q", q); u.searchParams.set("num", "10");
        const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
        const j = (await res.json()) as { items?: { title: string; link: string; snippet?: string }[]; error?: { message: string } };
        if (j.error) throw new Error(`google-cse: ${j.error.message}`);
        return (j.items ?? []).map((r, i) => ({ title: r.title, link: r.link, snippet: r.snippet, position: i + 1 }));
      },
    };
  }
  throw new Error("No search key found. Set SERPAPI_KEY (serpapi.com), SERPER_API_KEY (serper.dev), or GOOGLE_CSE_KEY + GOOGLE_CSE_CX in .env.local.");
}

interface Row {
  id: string;
  full_name: string;
  organisation: { name: string | null } | null;
}

async function loadEligible(db: SupabaseClient, limit: number): Promise<Row[]> {
  const { data, error } = await db
    .from("contacts")
    .select("id, full_name, organisation:organisations(name)")
    .is("job_title", null)
    .is("linkedin_url", null)
    .eq("not_on_linkedin", false)
    .not("full_name", "is", null)
    .not("organisation_id", "is", null)
    .order("id", { ascending: true })
    .limit(Number.isFinite(limit) ? limit : 5000);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

async function logEvent(db: SupabaseClient, contactId: string, message: string) {
  await db.from("events").insert({ contact_id: contactId, type: "crm_change", payload: { kind: "job_title_enrich", message }, source: "enrich-job-titles" });
}

async function main() {
  const provider = resolveProvider();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows = await loadEligible(db, LIMIT);

  console.log(`Provider: ${provider.name}${DRY ? " · DRY RUN" : ""}`);
  console.log(`Processing ${rows.length} contact(s) · ${DELAY_MS / 1000}s between searches\n`);

  let titled = 0, urlOnly = 0, notFound = 0, errors = 0;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i]!;
    const company = c.organisation?.name ?? null;
    const q = buildQuery(c.full_name, company);
    const tag = `[${i + 1}/${rows.length}] ${c.full_name}${company ? ` @ ${company}` : ""}`;

    let results: SerpResult[];
    try {
      results = await provider.search(q);
    } catch (e) {
      errors++;
      console.error(`${tag}  ✗ search error: ${(e as Error).message}`);
      console.error("Stopping so the quota/key can be checked — re-run to resume.");
      break;
    }

    const match = pickMatch(results, c.full_name, company);
    if (!match) {
      console.log(`${tag}  — no LinkedIn match → not_on_linkedin`);
      if (!DRY) { await db.from("contacts").update({ not_on_linkedin: true }).eq("id", c.id); await logEvent(db, c.id, "No LinkedIn profile found in Google SERP — marked not on LinkedIn"); }
      notFound++;
    } else if (match.jobTitle) {
      console.log(`${tag}  ✓ ${match.jobTitle}   (${match.link})`);
      if (!DRY) { await db.from("contacts").update({ job_title: match.jobTitle, linkedin_url: match.link }).eq("id", c.id); await logEvent(db, c.id, `Job title from LinkedIn SERP: ${match.jobTitle}`); }
      titled++;
    } else {
      console.log(`${tag}  ~ profile found, no title in SERP → URL only   (${match.link})`);
      if (!DRY) { await db.from("contacts").update({ linkedin_url: match.link }).eq("id", c.id); await logEvent(db, c.id, "LinkedIn profile found in SERP (no title visible) — URL saved"); }
      urlOnly++;
    }

    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. titled: ${titled} · url-only: ${urlOnly} · not-found: ${notFound} · errors: ${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

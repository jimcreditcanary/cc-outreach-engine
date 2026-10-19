// Reusable SERP client. Provider auto-detected from env (same precedence as the
// job-title enricher): SERPAPI_KEY (serpapi.com) → SERPER_API_KEY (serper.dev)
// → GOOGLE_CSE_KEY + GOOGLE_CSE_CX. Used by the per-contact research step.

export interface SerpResult {
  title: string;
  link: string;
  snippet?: string;
  position?: number;
}

export type Provider = (q: string) => Promise<SerpResult[]>;

export function serpEnabled(): boolean {
  return !!(process.env.SERPAPI_KEY || process.env.SERPER_API_KEY || (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX));
}

export function resolveProvider(): { name: string; search: Provider } {
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
  throw new Error("No search key found. Set SERPER_API_KEY (serper.dev), SERPAPI_KEY, or GOOGLE_CSE_KEY + GOOGLE_CSE_CX in .env.local.");
}

export async function serpSearch(q: string): Promise<SerpResult[]> {
  return resolveProvider().search(q);
}

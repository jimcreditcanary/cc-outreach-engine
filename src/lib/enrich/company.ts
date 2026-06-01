// Per-company enrichment: scrape their site → short factual summary +
// auto-discover their RSS / blog feed → last 5 posts. Both stored on the
// org row so the draft generator can reference real, current context.

import { parse as parseHtml } from "node-html-parser";
import { serviceClient } from "../db/client";
import { generateText } from "../ai/claude";
import { parseFeed } from "../signals/rss";

type DB = ReturnType<typeof serviceClient>;

const COMMON_FEED_PATHS = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/blog/feed",
  "/blog/rss",
  "/blog/feed/",
  "/news/feed",
  "/news/rss",
];

export interface RecentPost {
  title: string;
  url: string;
  published_at: string | null;
  summary: string;
}

export interface EnrichmentResult {
  summary: string | null;
  posts: RecentPost[];
  source: { html: boolean; feed: string | null };
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "CreditCanaryBot/1.0 (+https://creditcanary.co.uk)" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function normaliseUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/$/, "");
}

async function discoverFeed(siteUrl: string, html: string | null): Promise<string | null> {
  const base = new URL(siteUrl);

  // 1) <link rel="alternate" type="application/rss+xml" href="…">
  if (html) {
    const m = html.match(
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i,
    );
    if (m?.[1]) {
      const href = m[1];
      return href.startsWith("http") ? href : new URL(href, base.origin).toString();
    }
  }

  // 2) Try common paths
  for (const path of COMMON_FEED_PATHS) {
    const candidate = `${base.origin}${path}`;
    const body = await fetchText(candidate, 5000);
    if (body && (body.includes("<rss") || body.includes("<feed"))) return candidate;
  }
  return null;
}

function stripBoilerplate(html: string): string {
  const root = parseHtml(html);
  for (const sel of ["script", "style", "nav", "footer", "header", "noscript", "svg", "form"]) {
    root.querySelectorAll(sel).forEach((el) => el.remove());
  }
  const main = root.querySelector("main") || root.querySelector("article") || root;
  return main.text.replace(/\s+/g, " ").trim().slice(0, 8000);
}

/** Crawl + summarise + pull feed. Writes back to organisations.* and
 *  returns what was discovered (for the UI flash). */
export async function enrichCompany(db: DB, orgId: string): Promise<EnrichmentResult> {
  const { data: org, error } = await db
    .from("organisations")
    .select("name, website")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  if (!org?.website) {
    throw new Error("This company has no website on file — add one before enriching.");
  }

  const url = normaliseUrl(org.website);
  let summary: string | null = null;
  let posts: RecentPost[] = [];

  // 1) Homepage scrape + AI summary
  const html = await fetchText(url);
  if (html) {
    const cleaned = stripBoilerplate(html);
    if (cleaned.length > 120) {
      try {
        summary = (
          await generateText({
            system:
              "You write neutral, factual 2-3 sentence summaries of UK lenders, fintechs, building societies and credit unions based on their own website copy. " +
              "Plain prose, no marketing adjectives, no 'leading' / 'innovative'. Output ONLY the summary.",
            user: `Company: ${org.name}\nWebsite text:\n\n${cleaned}`,
            effort: "low",
            maxTokens: 400,
            cacheSystem: false,
          })
        ).trim() || null;
      } catch (e) {
        console.error("summary gen failed", e);
      }
    }
  }

  // 2) Feed discovery + parse (last 5 posts)
  const feedUrl = await discoverFeed(url, html);
  if (feedUrl) {
    const feedXml = await fetchText(feedUrl);
    if (feedXml) {
      try {
        const items = parseFeed(feedXml).slice(0, 5);
        posts = items.map((it) => ({
          title: it.title,
          url: it.link,
          published_at: it.published ?? null,
          summary: (it.summary ?? "").slice(0, 400),
        }));
      } catch (e) {
        console.error("feed parse failed", e);
      }
    }
  }

  await db
    .from("organisations")
    .update({
      company_summary: summary,
      recent_posts: posts,
      enriched_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  // Surface fresh posts as alerts so the operator sees "X just published Y"
  // on /alerts without having to crawl every company page. Best-effort.
  try {
    const { data: orgRow } = await db.from("organisations").select("id, name, owner_id").eq("id", orgId).maybeSingle();
    if (orgRow && posts.length) {
      const { detectPostAlerts } = await import("../alerts/detect");
      await detectPostAlerts(db, orgRow as { id: string; name: string | null; owner_id: string | null }, posts);
    }
  } catch (e) {
    console.error("post-alert detection failed", e);
  }

  return { summary, posts, source: { html: !!html, feed: feedUrl } };
}

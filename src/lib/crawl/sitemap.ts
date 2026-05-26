// Fetch and parse a sitemap.xml into URLs + lastmod dates.

export interface SitemapEntry {
  url: string;
  lastmod?: string;
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  for (const block of blocks) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim();
    entries.push({ url: loc, lastmod });
  }
  return entries;
}

export async function fetchSitemap(sitemapUrl: string): Promise<SitemapEntry[]> {
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`sitemap fetch ${res.status} for ${sitemapUrl}`);
  return parseSitemap(await res.text());
}

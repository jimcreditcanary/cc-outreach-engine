// Site crawler → content_assets.
//
//   npm run crawl              (defaults to creditcanary.co.uk sitemap)
//   npm run crawl -- <sitemapUrl>
//
// Reads the sitemap, fetches each page, extracts title/description/body,
// classifies type + module/sector tags from the URL, and upserts into
// content_assets (keyed by url). Problem-lane tagging is layered on later
// by the targeting-map pass.

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { fetchSitemap } from "../src/lib/crawl/sitemap";
import { extract } from "../src/lib/crawl/extract";
import { classify } from "../src/lib/crawl/classify";

config({ path: ".env.local" });

const DEFAULT_SITEMAP = "https://www.creditcanary.co.uk/sitemap.xml";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sitemapUrl = process.argv[2] ?? DEFAULT_SITEMAP;
  const db = serviceClient();

  const entries = await fetchSitemap(sitemapUrl);
  console.log(`Sitemap: ${entries.length} URLs`);

  let ok = 0;
  let failed = 0;
  for (const { url, lastmod } of entries) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  ${res.status} ${url}`);
        failed++;
        continue;
      }
      const { title, description, body_text } = extract(await res.text());
      const { type, tags_sector, tags_module } = classify(url);

      const { error } = await db.from("content_assets").upsert(
        {
          url,
          title: title ?? null,
          type,
          tags_sector,
          tags_module,
          description: description ?? null,
          body_text: body_text ?? null,
          published_at: lastmod ?? null,
          crawled_at: new Date().toISOString(),
        },
        { onConflict: "url" },
      );
      if (error) throw error;
      ok++;
    } catch (e) {
      console.warn(`  FAIL ${url}: ${(e as Error).message}`);
      failed++;
    }
    await sleep(200); // be polite
  }

  console.log(`Crawled ${ok} assets (${failed} skipped/failed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

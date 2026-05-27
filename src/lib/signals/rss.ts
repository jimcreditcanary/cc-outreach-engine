// Minimal RSS + Atom parser (pure, regex-based — no XML dep, same approach as
// the sitemap parser). Handles RSS <item> and Atom <entry>, CDATA, and Atom's
// self-closing <link href="…"/>.

export interface FeedItem {
  title: string;
  link: string;
  published?: string;
  summary?: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "") // strip tags after decoding escaped angle brackets
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]!) : undefined;
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const title = tagText(b, "title");
    // RSS: <link>url</link>. Atom: <link href="url" .../> (self-closing).
    let link = tagText(b, "link");
    if (!link) link = b.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1];
    if (!title || !link) continue;
    const published =
      tagText(b, "pubDate") ?? tagText(b, "published") ?? tagText(b, "updated") ?? tagText(b, "dc:date");
    const summary = (tagText(b, "description") ?? tagText(b, "summary"))?.slice(0, 600);
    items.push({ title, link, published, summary });
  }
  return items;
}

import { describe, it, expect } from "vitest";
import { parseFeed } from "../rss";

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[Consumer Duty review]]></title>
    <link>https://fca.org.uk/news/a</link>
    <pubDate>Mon, 12 Jan 2026 09:00:00 GMT</pubDate>
    <description>&lt;p&gt;FCA sets out expectations.&lt;/p&gt;</description></item>
  <item><title>APP fraud rules</title><link>https://fca.org.uk/news/b</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>BoE rate decision</title>
    <link rel="alternate" href="https://boe.co.uk/news/x"/>
    <updated>2026-02-01T12:00:00Z</updated>
    <summary>The MPC voted to hold.</summary></entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items (CDATA, entity-decoded description)", () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("Consumer Duty review");
    expect(items[0]!.link).toBe("https://fca.org.uk/news/a");
    expect(items[0]!.published).toContain("2026");
    expect(items[0]!.summary).toBe("FCA sets out expectations.");
    expect(items[1]!.title).toBe("APP fraud rules");
  });

  it("parses Atom entries with self-closing link href", () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("BoE rate decision");
    expect(items[0]!.link).toBe("https://boe.co.uk/news/x");
    expect(items[0]!.summary).toBe("The MPC voted to hold.");
  });

  it("returns empty for junk", () => {
    expect(parseFeed("<html>nope</html>")).toEqual([]);
  });
});

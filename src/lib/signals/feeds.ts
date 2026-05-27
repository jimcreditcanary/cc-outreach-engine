// Signal feeds — the §6 monitor list. FCA and BoE expose RSS; PSR does not
// (no feed found — add when one surfaces, or scrape its news page later).

export interface Feed {
  name: string;
  url: string;
  source: string;
}

export const FEEDS: Feed[] = [
  { name: "FCA News", url: "https://www.fca.org.uk/news/rss.xml", source: "fca" },
  { name: "Bank of England News", url: "https://www.bankofengland.co.uk/rss/news", source: "boe" },
];

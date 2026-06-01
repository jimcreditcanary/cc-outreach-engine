// Decode the small set of HTML entities that RSS feeds love to ship —
// &#8217; (smart apostrophe), &#8211; (en-dash), &amp; — so the UI doesn't
// render them as escaped text. React's text nodes don't decode entities;
// they pass them through literally, so we have to do it before rendering.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

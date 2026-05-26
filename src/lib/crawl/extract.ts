// Extract clean text + metadata from a fetched HTML page.

import { parse } from "node-html-parser";

export interface Extracted {
  title?: string;
  description?: string;
  body_text?: string;
}

/** Collapse whitespace and trim. */
function tidy(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t === "" ? undefined : t;
}

export function extract(html: string): Extracted {
  const root = parse(html, { comment: false });

  const title =
    tidy(root.querySelector("meta[property='og:title']")?.getAttribute("content")) ??
    tidy(root.querySelector("title")?.text) ??
    tidy(root.querySelector("h1")?.text);

  const description =
    tidy(root.querySelector("meta[name='description']")?.getAttribute("content")) ??
    tidy(root.querySelector("meta[property='og:description']")?.getAttribute("content"));

  // Strip non-content elements before pulling text.
  for (const sel of ["script", "style", "nav", "footer", "header", "noscript", "svg"]) {
    root.querySelectorAll(sel).forEach((el) => el.remove());
  }
  // Prefer <main> / <article> if present, else the body.
  const main =
    root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  const body_text = tidy(main.text);

  return { title, description, body_text };
}

// Server-only brand extraction for the demo generator. We fetch the
// prospect's site, pull logo candidates + a theme colour from the markup,
// and ask Claude to read the page text for tone, product type, a brand hex
// (when there's no theme-color) and a short pitch line. Claude can't see
// pixels, so the logo + colour are always reviewable/overridable in the UI.

import { parse, type HTMLElement } from "node-html-parser";
import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { PRODUCT_TYPES, type Branding } from "./types";

/** Add https:// if missing; throw on anything that isn't a plausible host. */
export function normaliseUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s); // throws if hopeless
  if (!u.hostname.includes(".")) throw new Error("That doesn't look like a website address.");
  return u.toString();
}

function abs(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** Ordered logo candidates: logo-named <img> first, then social/app icons. */
function logoCandidates(root: HTMLElement, base: string): string[] {
  const out: string[] = [];
  const push = (u: string | null) => { if (u && !out.includes(u)) out.push(u); };

  // <img> whose src/alt/class hints "logo" — strongest signal.
  for (const img of root.querySelectorAll("img")) {
    const hay = `${img.getAttribute("src") ?? ""} ${img.getAttribute("alt") ?? ""} ${img.getAttribute("class") ?? ""}`.toLowerCase();
    if (hay.includes("logo")) push(abs(img.getAttribute("src") ?? img.getAttribute("data-src"), base));
  }
  // Social card image + app/touch icons.
  push(abs(root.querySelector('meta[property="og:image"]')?.getAttribute("content"), base));
  push(abs(root.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"), base));
  for (const l of root.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) {
    push(abs(l.getAttribute("href"), base));
  }
  return out.slice(0, 8);
}

function themeColor(root: HTMLElement): string | null {
  const c = root.querySelector('meta[name="theme-color"]')?.getAttribute("content")?.trim();
  return c && /^#?[0-9a-f]{3,8}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`) : null;
}

/** Strip scripts/styles + collapse to visible-ish text, capped for the prompt. */
function visibleText(root: HTMLElement): string {
  for (const el of root.querySelectorAll("script, style, noscript, svg")) el.remove();
  const title = root.querySelector("title")?.text ?? "";
  const desc = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const body = (root.querySelector("body")?.text ?? root.text ?? "").replace(/\s+/g, " ").trim();
  return `TITLE: ${title}\nDESCRIPTION: ${desc}\n\n${body}`.slice(0, 6000);
}

const ClassifySchema = z.object({
  bg_color: z.string().describe("The brand's primary colour as a hex string like #1A73E8. Best guess from the brand if unsure."),
  tone: z.string().max(60).describe("Short tone-of-voice descriptor, e.g. 'Warm and reassuring' or 'Bold, fintech-modern'."),
  product_type: z.enum(PRODUCT_TYPES).describe("The single closest lending product this company offers."),
  description: z.string().max(400).describe("Two punchy sentences pitching a branded demo of our origination console to this company."),
});

export async function retrieveBranding(rawUrl: string, companyName: string): Promise<Branding> {
  const company_url = normaliseUrl(rawUrl);

  let html = "";
  try {
    const res = await fetch(company_url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CreditCanaryBot/1.0)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (res.ok) html = await res.text();
  } catch { /* fall through — Claude still classifies from the name */ }

  const root = html ? parse(html) : parse("<html></html>");
  const candidates = logoCandidates(root, company_url);
  const theme = themeColor(root);
  const text = visibleText(root);

  const classified = await generateStructured({
    system:
      "You profile a UK lender's website to brand a sales demo. Be decisive. " +
      "Pick the single closest product type from the allowed set. For bg_color, prefer the site's real brand colour; " +
      "if you can't tell, give a sensible on-brand hex. Keep tone + description tight.",
    user: `COMPANY: ${companyName}\nURL: ${company_url}\n${theme ? `DETECTED THEME COLOUR: ${theme}\n` : ""}\nPAGE CONTENT:\n${text || "(could not fetch page — infer from the company name)"}`,
    schema: ClassifySchema,
    effort: "low",
    cacheSystem: false,
  });

  return {
    company_url,
    logo_url: candidates[0] ?? null,
    logo_candidates: candidates,
    // A real theme-color beats the model's guess.
    bg_color: theme ?? normaliseHex(classified.bg_color),
    tone: classified.tone,
    product_type: classified.product_type,
    description: classified.description,
  };
}

function normaliseHex(c: string): string {
  const t = c.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return t;
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t}`;
  return "#1f2937"; // neutral fallback
}

// Pure helpers for lifting a job title from a Google SERP result that points
// at a LinkedIn profile. We NEVER fetch linkedin.com — we only read the
// title/snippet text the search engine already returned. Kept pure so the
// (fiddly) name-matching + title-parsing is unit-testable.

export interface SerpResult {
  title: string;
  link: string;
  snippet?: string;
  position?: number;
}

/** lowercase, strip accents, keep a–z0–9 + spaces, collapse whitespace. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEPARATORS = [" - ", " – ", " — ", " | ", " · ", " on LinkedIn", ": "];

/** The name portion of a LinkedIn SERP title — the bit before the first
 *  separator. "Jane Smith - Head of Risk - Acme | LinkedIn" → "Jane Smith". */
export function titleNamePart(title: string): string {
  let cut = title;
  let best = title.length;
  for (const sep of SEPARATORS) {
    const i = title.indexOf(sep);
    if (i >= 0 && i < best) best = i;
  }
  if (best < title.length) cut = title.slice(0, best);
  return cut.trim();
}

export function isLinkedInProfile(link: string): boolean {
  return /(^|\/\/|\.)linkedin\.com\/in\//i.test(link);
}

/** Does this SERP title belong to the person we searched for? Requires the
 *  contact's first AND last name to both appear in the title's name part. */
export function nameMatches(serpTitle: string, fullName: string): boolean {
  const want = norm(fullName).split(" ").filter(Boolean);
  if (want.length < 2) return false;
  const have = new Set(norm(titleNamePart(serpTitle)).split(" ").filter(Boolean));
  const first = want[0]!;
  const last = want[want.length - 1]!;
  return have.has(first) && have.has(last);
}

/** Extract the job title from a matched LinkedIn SERP title.
 *  "Jane Smith - Head of Risk - Acme Ltd | LinkedIn" → "Head of Risk"
 *  "Jane Smith - Head of Risk at Acme | LinkedIn"    → "Head of Risk"
 *  "Jane Smith - Acme Ltd | LinkedIn"                → null (company only)
 *  Returns null when nothing title-shaped can be isolated. */
export function extractJobTitle(serpTitle: string, companyName: string | null): string | null {
  let t = serpTitle;
  // Strip trailing "| LinkedIn" / "- LinkedIn" / "on LinkedIn".
  t = t.replace(/\s*[-–—|]\s*LinkedIn\s*$/i, "").replace(/\s+on LinkedIn.*$/i, "").trim();
  // Drop the leading name part + its separator.
  const namePart = titleNamePart(t);
  let rest = t.slice(namePart.length).replace(/^\s*[-–—|·:]\s*/, "").trim();
  if (!rest) return null;

  // First segment before the next separator is the candidate title.
  let candidate = rest;
  for (const sep of [" - ", " – ", " — ", " | ", " · ", " @ ", " I "]) {
    const i = rest.indexOf(sep);
    if (i >= 0) { candidate = rest.slice(0, i); break; }
  }
  candidate = tidyTitle(candidate);

  // Reject if it's just the company name, junk, or a non-title headline.
  if (!candidate) return null;
  if (companyName && norm(candidate) === norm(companyName)) return null;
  if (!isPlausibleTitle(candidate)) return null;
  return candidate;
}

/** Common trim applied to a raw title fragment: cut at a sentence boundary,
 *  drop a leaked "@Company"/"at Company", strip leading headline qualifiers
 *  and trailing ellipsis/punctuation. */
export function tidyTitle(raw: string): string {
  let c = raw.trim();
  // First segment before a separator: "Public Policy I Govt Relations I …" → "Public Policy".
  for (const sep of [" - ", " – ", " — ", " | ", " · ", " I "]) {
    const i = c.indexOf(sep);
    if (i > 0) c = c.slice(0, i);
  }
  // Sentence boundary: "CEO. Advantage Finance" → "CEO".
  const dot = c.search(/\.\s/);
  if (dot > 0) c = c.slice(0, dot);
  // "Head of Risk at Acme" → "Head of Risk"; trailing "@Company".
  const atIdx = c.toLowerCase().lastIndexOf(" at ");
  if (atIdx > 0) c = c.slice(0, atIdx);
  c = c.replace(/\s*@\s*\S.*$/, "");
  // Leading headline qualifiers that aren't the role.
  c = c.replace(/^(experienced|seasoned|former|formerly|ex|aspiring)\s+/i, "");
  // Trailing ellipsis / stray punctuation.
  c = c.replace(/\s*(\.{2,}|…)\s*$/, "").replace(/[\s.,;:–-]+$/, "").trim();
  // Dangling connectors left when a sentence was cut: "…, Germany and" → "…, Germany".
  let prev: string;
  do { prev = c; c = c.replace(/[\s,]+(and|with|for|of|to|the|a|an|in|on|at|part|&)\s*$/i, "").trim(); } while (c !== prev);
  return c;
}

const GENERIC = new Set(["leader", "senior leader", "professional", "expert", "consultant", "specialist", "manager", "director", "owner", "founder"]);

/** Is this a real-looking job title, vs a tagline / sentence / location? */
export function isPlausibleTitle(t: string): boolean {
  if (!t || t.length < 2 || t.length > 70) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (/^[a-z]/.test(t)) return false; // sentence fragments start lowercase
  // Tagline / sentence openers.
  if (/^(at|we|our|helping|driving|building|passionate|making|bringing|delivering|enabling|supporting|creating|transforming|empowering)\b/i.test(t)) return false;
  // Location-shaped ("Walton-On-Thames, England", "London, United Kingdom").
  if (/,\s*(england|scotland|wales|northern ireland|united kingdom|uk)\b/i.test(t) && !/\b(manager|director|head|officer|lead|analyst|executive|partner|chief|president|vp|ceo|cfo|coo|cto|cro)\b/i.test(t)) return false;
  // Too vague on its own.
  if (GENERIC.has(t.toLowerCase())) return false;
  return true;
}

export interface SerpMatch {
  link: string;
  jobTitle: string | null;
}

/** Find the best LinkedIn-profile match in the top results for a contact.
 *  Only considers the top `topN` (the ask: "exact match that comes up top").
 *  Returns the canonicalised profile URL + parsed title, or null. */
export function pickMatch(results: SerpResult[], fullName: string, companyName: string | null, topN = 5): SerpMatch | null {
  for (const r of results.slice(0, topN)) {
    if (!r.link || !isLinkedInProfile(r.link)) continue;
    if (!nameMatches(r.title, fullName)) continue;
    return { link: canonicalLinkedIn(r.link), jobTitle: extractJobTitle(r.title, companyName) };
  }
  return null;
}

/** Strip query/fragment + trailing slash; force https + www. */
export function canonicalLinkedIn(link: string): string {
  try {
    const u = new URL(link);
    const path = u.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${path}`;
  } catch {
    return link.split(/[?#]/)[0]!.replace(/\/+$/, "");
  }
}

/** Re-clean an already-stored title. Returns the tidied title, or null if
 *  what's stored isn't a real title (tagline/sentence/location) and should
 *  be cleared. Used by scripts/clean-job-titles.ts over the SERP-enriched set. */
export function cleanStoredTitle(stored: string | null): string | null {
  if (!stored) return null;
  const t = tidyTitle(stored);
  return isPlausibleTitle(t) ? t : null;
}

/** The Google query string for a contact. */
export function buildQuery(fullName: string, companyName: string | null): string {
  return `site:linkedin.com/in "${fullName}"${companyName ? ` ${companyName}` : ""}`;
}

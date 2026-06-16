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
  for (const sep of [" - ", " – ", " — ", " | ", " · ", " @ "]) {
    const i = rest.indexOf(sep);
    if (i >= 0) { candidate = rest.slice(0, i); break; }
  }
  // "Head of Risk at Acme" → "Head of Risk"; "Head of Risk @Acme" → "Head of Risk".
  const atIdx = candidate.toLowerCase().lastIndexOf(" at ");
  if (atIdx > 0) candidate = candidate.slice(0, atIdx);
  candidate = candidate.replace(/\s*@\s*\S.*$/, ""); // strip a trailing "@Company"
  // Drop headline qualifiers that aren't part of the role itself.
  candidate = candidate.replace(/^(experienced|seasoned|former|formerly|ex)\s+/i, "");
  candidate = candidate.trim();

  // Reject if it's just the company name, or junk.
  if (!candidate) return null;
  if (companyName && norm(candidate) === norm(companyName)) return null;
  if (candidate.length < 2 || candidate.length > 90) return null;
  if (!/[a-z]/i.test(candidate)) return null;
  return candidate;
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

/** The Google query string for a contact. */
export function buildQuery(fullName: string, companyName: string | null): string {
  return `site:linkedin.com/in "${fullName}"${companyName ? ` ${companyName}` : ""}`;
}

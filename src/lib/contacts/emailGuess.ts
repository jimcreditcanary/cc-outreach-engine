// Infer a company's email convention from the colleagues we already have
// addresses for, then guess the address of a colleague we don't.
//
// Pure + deterministic so it's unit-testable and the (consequential) guess
// logic can be reasoned about. The script in scripts/guess-emails.ts wires
// it to the DB. Guesses are always flagged email_guessed=true and kept out
// of auto-send until a human verifies — a wrong guess that bounces hurts
// sender reputation, so the bar for emitting one is deliberately high.

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "aol.com", "protonmail.com", "proton.me", "gmx.com", "msn.com",
]);

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "mx"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "mba", "cfa", "frics", "acca"]);

/** Lowercase, strip accents and any non a–z0–9 (so O'Brien → obrien). */
export function normalizeToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface ParsedName {
  first: string;
  last: string | null;
}

/** "Dr. Mary-Jane O'Brien Jr" → { first: "maryjane", last: "obrien" }. */
export function parseName(full: string | null | undefined): ParsedName | null {
  if (!full) return null;
  let tokens = full.trim().split(/\s+/).filter(Boolean);
  // Drop leading honorifics and trailing suffixes (comma-stripped).
  tokens = tokens.filter((t) => {
    const n = normalizeToken(t.replace(/\.$/, "").replace(/,$/, ""));
    return n && !HONORIFICS.has(n) && !SUFFIXES.has(n);
  });
  const parts = tokens.map(normalizeToken).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : null;
  if (!first) return null;
  return { first, last };
}

// Each pattern maps a parsed name → local-part. Returns null when the name
// lacks a part the pattern needs (e.g. a last-name pattern for "Cher").
type PatternFn = (n: ParsedName) => string | null;

export const PATTERNS: Record<string, PatternFn> = {
  "first.last": (n) => (n.last ? `${n.first}.${n.last}` : null),
  "first_last": (n) => (n.last ? `${n.first}_${n.last}` : null),
  "firstlast": (n) => (n.last ? `${n.first}${n.last}` : null),
  "first-last": (n) => (n.last ? `${n.first}-${n.last}` : null),
  "flast": (n) => (n.last ? `${n.first[0]}${n.last}` : null),
  "f.last": (n) => (n.last ? `${n.first[0]}.${n.last}` : null),
  "firstl": (n) => (n.last ? `${n.first}${n.last[0]}` : null),
  "last.first": (n) => (n.last ? `${n.last}.${n.first}` : null),
  "lastfirst": (n) => (n.last ? `${n.last}${n.first}` : null),
  "first": (n) => n.first,
  "last": (n) => n.last,
};

// Single-token patterns ("first", "last") are weak — many people share a
// first name, so a lone "john@acme.com" sample shouldn't license guessing
// every colleague's address. They only win if nothing structured matches.
const WEAK_PATTERNS = new Set(["first", "last"]);

export interface Sample {
  full_name: string | null;
  email: string;
}

export interface InferredConvention {
  pattern: string;
  domain: string;
  /** samples whose address this pattern+domain reproduces */
  agree: number;
  /** total usable samples (parseable name + corporate-domain email) */
  considered: number;
  confidence: number; // agree / considered
}

function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.trim().toLowerCase();
  const i = at.lastIndexOf("@");
  if (i <= 0 || i === at.length - 1) return null;
  return { local: at.slice(0, i), domain: at.slice(i + 1) };
}

/** Work out a company's dominant address convention from known colleagues. */
export function inferConvention(samples: Sample[]): InferredConvention | null {
  // Tally corporate (non-freemail) domains; pick the most common.
  const domainCount = new Map<string, number>();
  const parsed: { name: ParsedName; local: string; domain: string }[] = [];
  for (const s of samples) {
    const e = splitEmail(s.email);
    if (!e || FREEMAIL.has(e.domain)) continue;
    const name = parseName(s.full_name);
    if (!name) continue;
    parsed.push({ name, local: e.local, domain: e.domain });
    domainCount.set(e.domain, (domainCount.get(e.domain) ?? 0) + 1);
  }
  if (parsed.length === 0) return null;
  const domain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const onDomain = parsed.filter((p) => p.domain === domain);

  // Vote: how many on-domain samples each pattern reproduces.
  const votes = new Map<string, number>();
  for (const [key, fn] of Object.entries(PATTERNS)) {
    let n = 0;
    for (const p of onDomain) if (fn(p.name) === p.local) n++;
    if (n > 0) votes.set(key, n);
  }
  if (votes.size === 0) return null;

  // Prefer the strongest structured pattern; only fall back to weak
  // single-token ones if no structured pattern matched at all.
  const ranked = [...votes.entries()].sort((a, b) => {
    const wa = WEAK_PATTERNS.has(a[0]) ? 1 : 0;
    const wb = WEAK_PATTERNS.has(b[0]) ? 1 : 0;
    if (wa !== wb) return wa - wb;        // structured first
    if (b[1] !== a[1]) return b[1] - a[1]; // then most agreement
    return a[0].localeCompare(b[0]);       // stable
  });
  const [pattern, agree] = ranked[0]!;
  return { pattern, domain, agree, considered: onDomain.length, confidence: agree / onDomain.length };
}

/** Build the guessed address for a name under a known convention. Returns
 *  null if the name can't satisfy the pattern. */
export function guessEmail(fullName: string | null | undefined, conv: { pattern: string; domain: string }): string | null {
  const name = parseName(fullName);
  if (!name) return null;
  const fn = PATTERNS[conv.pattern];
  if (!fn) return null;
  const local = fn(name);
  if (!local) return null;
  return `${local}@${conv.domain}`;
}

// Anonymisation guard (build brief §7 / targeting-map §1) — HARD rule.
//
// Generated drafts must NEVER name a client or imply whose proof a metric
// belongs to. This is the post-generation check: any draft containing a
// roster name is rejected before it can be queued/sent. The roster MUST
// stay in sync with §1 of creditcanary-targeting-map.md — add a name here
// the moment it's added there.
//
// Matching is case-insensitive and word-boundary anchored so we reject the
// real reference ("TSB", "NE First") without tripping on substrings.

export interface RosterEntry {
  /** Canonical client name (for reporting which name leaked). */
  canonical: string;
  /** The approved anonymised descriptor to use instead. */
  descriptor: string;
  /** Patterns that constitute a leak. */
  patterns: RegExp[];
}

export const ROSTER: RosterEntry[] = [
  {
    canonical: "TSB",
    descriptor: "a tier 1 UK retail bank",
    patterns: [/\bTSB\b/i],
  },
  {
    canonical: "GMB Credit Union",
    descriptor: "a large national credit union",
    patterns: [/\bGMB\b/i],
  },
  {
    canonical: "NE First Credit Union",
    descriptor: "a regional credit union",
    patterns: [/\bNE\s+First\b/i, /\bNEFirst\b/i],
  },
];

export interface AnonymisationResult {
  clean: boolean;
  /** Canonical names that leaked into the text. */
  hits: string[];
}

/**
 * Check a draft (subject + body) against the roster. `clean: false` means
 * the draft MUST NOT be sent — regenerate or fix.
 */
export function checkAnonymisation(text: string, roster: RosterEntry[] = ROSTER): AnonymisationResult {
  const hits: string[] = [];
  for (const entry of roster) {
    if (entry.patterns.some((p) => p.test(text))) hits.push(entry.canonical);
  }
  return { clean: hits.length === 0, hits };
}

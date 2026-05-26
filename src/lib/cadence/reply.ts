// Reply classification (build brief §9/§12). Detect opt-out intent so we can
// suppress instantly and honour PECR. Conservative — only clear opt-out
// language trips it; everything else is a normal reply for Jim to handle.

const UNSUB_PATTERNS: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bstop (?:emailing|contacting|messaging)\b/i,
  /\bno longer (?:wish|want)\b/i,
  /\bdo not (?:contact|email)\b/i,
  /\bdon'?t (?:contact|email) me\b/i,
];

/** True if the reply body expresses an opt-out / unsubscribe intent. */
export function isUnsubscribe(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  // A bare "stop" / "unsubscribe" reply counts.
  if (/^(stop|unsubscribe)\b/i.test(t)) return true;
  return UNSUB_PATTERNS.some((re) => re.test(t));
}

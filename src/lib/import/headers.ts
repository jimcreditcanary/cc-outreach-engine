// Header normalisation for tolerant CRM imports.
//
// Pipedrive exports use human column names prefixed by the entity they
// belong to, e.g. "Deal - Title", "Organization - Won deals",
// "Person - Email". The importer must survive column-name drift (UK/US
// spelling, extra spaces, casing), so we collapse every header to a
// canonical snake_case token before alias mapping (mappers.ts).

// Entity prefixes Pipedrive prepends. Order matters only for readability;
// matching is exact-prefix, case-insensitive.
const ENTITY_PREFIXES = [
  "deal",
  "organization",
  "organisation",
  "person",
  "contact",
  "note",
] as const;

/** Lower-case, strip a leading "<entity> - " prefix if present. */
export function stripEntityPrefix(header: string): string {
  const trimmed = header.trim();
  for (const prefix of ENTITY_PREFIXES) {
    const re = new RegExp(`^${prefix}\\s*-\\s*`, "i");
    if (re.test(trimmed)) return trimmed.replace(re, "");
  }
  return trimmed;
}

/**
 * "Deal - Expected close date" → "expected_close_date".
 * Strips the entity prefix, lower-cases, and collapses any run of
 * non-alphanumeric characters to a single underscore.
 */
export function normalizeHeader(header: string): string {
  return stripEntityPrefix(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build a map of normalised-header → original-header for a row's keys.
 * Later columns win on collision (rare, but deterministic).
 */
export function buildHeaderIndex(headers: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const h of headers) index.set(normalizeHeader(h), h);
  return index;
}

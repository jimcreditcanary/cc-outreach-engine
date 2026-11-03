// Parse a person's name into first + last, de-shouting Companies House's
// "SURNAME, Forename Middle" officer format and the natural-order PSC format,
// and title-casing both. Used to match CH directors/UBOs against existing
// company contacts and to seed new HubSpot contacts — brief §1.5.1.21:
// "FELL, James Alexander" → First=James, Last=Fell.

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "dame", "lord", "lady", "rev", "mx"]);

/** Title-case a name, leaving hyphens and apostrophes intact (O'Brien, Smith-Jones). */
export function titleCaseName(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

export interface PersonName {
  first: string;
  last: string;
}

export function parsePersonName(raw: string | null | undefined): PersonName {
  const s = (raw ?? "").trim();
  if (!s) return { first: "", last: "" };
  // Officer format: "SURNAME, Forename Middle"
  if (s.includes(",")) {
    const [surname = "", forenames = ""] = s.split(",");
    const first = forenames.trim().split(/\s+/)[0] ?? "";
    return { first: titleCaseName(first), last: titleCaseName(surname.trim()) };
  }
  // Natural order: "Mr James Alexander Fell" — drop a leading title.
  let tokens = s.split(/\s+/);
  if (tokens.length > 1 && TITLES.has(tokens[0]!.toLowerCase().replace(/\.$/, ""))) tokens = tokens.slice(1);
  const first = tokens[0] ?? "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1]! : "";
  return { first: titleCaseName(first), last: titleCaseName(last) };
}

/** Normalised key for matching two names by first + last (case-insensitive). */
export function nameMatchKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${(first ?? "").trim().toLowerCase()}|${(last ?? "").trim().toLowerCase()}`;
}

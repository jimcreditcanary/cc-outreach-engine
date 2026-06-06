// Sector display helpers — turn snake_case enum values into title-case
// for the UI. Stored values stay snake_case for the AI prompts +
// matching logic.

export function formatSector(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split("_")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

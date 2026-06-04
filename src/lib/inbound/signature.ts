// Parse a contact's email signature out of an inbound reply body. Aims
// for high precision over recall — only returns fields we're confident
// about so we can safely auto-patch the contact record without polluting
// it with garbage from quoted replies / threading footers.
//
// Strategy:
//   1. Truncate at the obvious quote markers (the reply text Postmark
//      already gives us as StrippedTextReply is mostly clean, but belt
//      + braces).
//   2. Take the LAST ~12 non-empty lines — that's where a signature
//      lives. Anything earlier is body prose we don't want to mine.
//   3. Run regex probes for mobile / phone / job title / company.
//   4. Return only the matches that look right (length thresholds,
//      whitelisted formats). Caller decides whether to patch — we never
//      decide for them.

export interface ParsedSignature {
  mobile: string | null;
  job_title: string | null;
  linkedin_url: string | null;
}

const QUOTE_MARKERS = [
  /^[> ]*On .+ wrote:$/im,                   // Gmail / generic
  /^-----Original Message-----$/im,          // Outlook
  /^From:\s.+/im,                            // Outlook header dump
  /^_{4,}$/m,                                // long underscore separator
];

/** Slice the body down to "just the new content + signature". */
function trimQuotedTail(body: string): string {
  let cut = body.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  return body.slice(0, cut);
}

/** Pull the last ~12 non-blank lines — signatures live at the foot. */
function signatureWindow(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-12);
}

/** UK / international mobile patterns. Accepts:
 *    +44 7xxx xxx xxx, 07xxx xxx xxx, 7xxx xxxxxx — with or without spaces.
 *  Rejects landlines (020 / 01xx / 02xx area codes). */
function pickMobile(lines: string[]): string | null {
  const candidates: string[] = [];
  for (const line of lines) {
    // Strip everything that isn't a digit, +, space, dash or paren.
    const stripped = line.replace(/[^\d+()\s-]/g, " ").trim();
    // Find sequences of 10+ digits (with separators).
    const re = /(\+?\d[\d\s\-()]{8,16}\d)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 14) continue;
      // UK mobile starts with 07 (national) or 447 (international).
      // International non-UK we accept if it starts with + and is 10-14 digits.
      const isUkMobile = /^447\d{9}$/.test(digits) || /^07\d{9}$/.test(digits);
      const isIntlMobile = raw.startsWith("+") && !raw.startsWith("+44") && digits.length >= 10;
      if (isUkMobile || isIntlMobile) candidates.push(raw.replace(/\s+/g, " ").trim());
    }
  }
  // Prefer the LAST candidate — signatures put phone after the name.
  return candidates.length ? candidates[candidates.length - 1]! : null;
}

/** Job title — look for a line that's 3-60 chars, mostly letters/punctuation
 *  (no digits), and contains one of the common role words. */
const ROLE_WORDS = /\b(CEO|CTO|CFO|COO|CMO|CIO|VP|Director|Manager|Head|Lead|Founder|Co-founder|Cofounder|President|Principal|Partner|Engineer|Developer|Architect|Designer|Analyst|Consultant|Officer|Specialist|Owner|Account|Sales|Marketing|Product|Operations|Engineering|Customer Success|Solutions)\b/i;
function pickJobTitle(lines: string[]): string | null {
  for (const line of lines) {
    if (line.length < 3 || line.length > 80) continue;
    if (/\d/.test(line)) continue; // titles don't have digits
    if (!ROLE_WORDS.test(line)) continue;
    // Avoid lines that are clearly URLs or emails.
    if (/https?:\/\//i.test(line) || /@/.test(line)) continue;
    return line;
  }
  return null;
}

/** LinkedIn URL pattern. */
function pickLinkedIn(lines: string[]): string | null {
  const re = /(https?:\/\/(?:www\.|uk\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?)/i;
  for (const line of lines) {
    const m = re.exec(line);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function parseSignature(body: string): ParsedSignature {
  if (!body || body.length < 20) return { mobile: null, job_title: null, linkedin_url: null };
  const trimmed = trimQuotedTail(body);
  const lines = signatureWindow(trimmed);
  return {
    mobile: pickMobile(lines),
    job_title: pickJobTitle(lines),
    linkedin_url: pickLinkedIn(lines),
  };
}

/** Tests live in src/lib/inbound/__tests__/signature.test.ts. */

import { describe, expect, it } from "vitest";
import { inferConvention, guessEmail, parseName, normalizeToken } from "../emailGuess";

describe("parseName", () => {
  it("drops honorifics + suffixes and strips punctuation", () => {
    expect(parseName("Dr. Mary-Jane O'Brien Jr")).toEqual({ first: "maryjane", last: "obrien" });
    expect(parseName("John Smith")).toEqual({ first: "john", last: "smith" });
    expect(parseName("Cher")).toEqual({ first: "cher", last: null });
    expect(parseName("  ")).toBeNull();
    expect(parseName(null)).toBeNull();
  });
  it("normalizes accents", () => {
    expect(normalizeToken("Renée")).toBe("renee");
    expect(parseName("José Núñez")).toEqual({ first: "jose", last: "nunez" });
  });
});

describe("inferConvention", () => {
  it("detects first.last and ignores freemail samples for the domain", () => {
    const conv = inferConvention([
      { full_name: "John Smith", email: "john.smith@acme.co.uk" },
      { full_name: "Jane Doe", email: "jane.doe@acme.co.uk" },
      { full_name: "Personal Person", email: "someone@gmail.com" }, // ignored
    ]);
    expect(conv).toMatchObject({ pattern: "first.last", domain: "acme.co.uk", agree: 2, considered: 2 });
    expect(conv!.confidence).toBe(1);
  });

  it("detects flast", () => {
    const conv = inferConvention([
      { full_name: "John Smith", email: "jsmith@lender.com" },
      { full_name: "Karen Lee", email: "klee@lender.com" },
    ]);
    expect(conv).toMatchObject({ pattern: "flast", domain: "lender.com" });
  });

  it("picks the most common corporate domain when colleagues differ", () => {
    const conv = inferConvention([
      { full_name: "A One", email: "a.one@bigco.com" },
      { full_name: "B Two", email: "b.two@bigco.com" },
      { full_name: "C Three", email: "c.three@old-domain.com" },
    ]);
    expect(conv!.domain).toBe("bigco.com");
  });

  it("returns null when there is no corporate domain", () => {
    expect(inferConvention([{ full_name: "Gmail User", email: "gmail.user@gmail.com" }])).toBeNull();
  });

  it("prefers a structured pattern over the weak single-token one", () => {
    // "john@acme.com" matches "first"; "jane.roe@acme.com" matches "first.last".
    // first.last must win so we don't guess everyone as just their first name.
    const conv = inferConvention([
      { full_name: "John X", email: "john@acme.com" },
      { full_name: "Jane Roe", email: "jane.roe@acme.com" },
      { full_name: "Bill Poe", email: "bill.poe@acme.com" },
    ]);
    expect(conv!.pattern).toBe("first.last");
  });
});

describe("guessEmail", () => {
  const conv = { pattern: "first.last", domain: "acme.co.uk" };
  it("applies the convention to a new colleague", () => {
    expect(guessEmail("Bob Jones", conv)).toBe("bob.jones@acme.co.uk");
    // Multi-token surnames collapse to the last token (accents stripped).
    expect(guessEmail("Dr. Aoife Ó Súilleabháin", conv)).toBe("aoife.suilleabhain@acme.co.uk");
  });
  it("returns null when the name can't satisfy the pattern", () => {
    expect(guessEmail("Madonna", conv)).toBeNull(); // no last name
    expect(guessEmail("", conv)).toBeNull();
  });
  it("round-trips inference → guess", () => {
    const c = inferConvention([
      { full_name: "John Smith", email: "jsmith@lender.com" },
      { full_name: "Karen Lee", email: "klee@lender.com" },
    ])!;
    expect(guessEmail("Paul Adams", c)).toBe("padams@lender.com");
  });
});

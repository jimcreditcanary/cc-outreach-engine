import { describe, expect, it } from "vitest";
import { buildQuery, canonicalLinkedIn, extractJobTitle, nameMatches, pickMatch, titleNamePart } from "../serpJobTitle";

describe("titleNamePart", () => {
  it("takes the bit before the first separator", () => {
    expect(titleNamePart("Jane Smith - Head of Risk - Acme | LinkedIn")).toBe("Jane Smith");
    expect(titleNamePart("Jane Smith | LinkedIn")).toBe("Jane Smith");
    expect(titleNamePart("Jane Smith on LinkedIn: We're hiring")).toBe("Jane Smith");
  });
});

describe("nameMatches", () => {
  it("matches on first + last, tolerant of middle names", () => {
    expect(nameMatches("Jane Smith - Head of Risk | LinkedIn", "Jane Smith")).toBe(true);
    expect(nameMatches("Jane A. Smith - CFO | LinkedIn", "Jane Smith")).toBe(true);
    expect(nameMatches("Renée Dupont - Analyst | LinkedIn", "Renee Dupont")).toBe(true);
  });
  it("rejects different people and single-token names", () => {
    expect(nameMatches("John Brown - CEO | LinkedIn", "Jane Smith")).toBe(false);
    expect(nameMatches("Madonna - Singer | LinkedIn", "Madonna")).toBe(false);
  });
});

describe("extractJobTitle", () => {
  it("pulls the title from the common formats", () => {
    expect(extractJobTitle("Jane Smith - Head of Risk - Acme Ltd | LinkedIn", "Acme Ltd")).toBe("Head of Risk");
    expect(extractJobTitle("Jane Smith - Head of Risk at Acme | LinkedIn", "Acme")).toBe("Head of Risk");
    expect(extractJobTitle("Jane Smith – Chief Financial Officer – Acme | LinkedIn", "Acme")).toBe("Chief Financial Officer");
  });
  it("returns null when only the company is present, or junk", () => {
    expect(extractJobTitle("Jane Smith - Acme Ltd | LinkedIn", "Acme Ltd")).toBeNull();
    expect(extractJobTitle("Jane Smith | LinkedIn", "Acme")).toBeNull();
  });
  it("strips a leaked @Company and headline qualifiers", () => {
    expect(extractJobTitle("James Hicks - MD Autolend @ Lendable | LinkedIn", "Lendable")).toBe("MD Autolend");
    expect(extractJobTitle("Chris Harper - Experienced Chief Risk Officer | LinkedIn", "Secure Trust Bank")).toBe("Chief Risk Officer");
    expect(extractJobTitle("Sam Lee - Former Head of Sales - Acme | LinkedIn", "Acme")).toBe("Head of Sales");
  });
});

describe("canonicalLinkedIn", () => {
  it("strips query/fragment + trailing slash, forces https/www", () => {
    expect(canonicalLinkedIn("https://uk.linkedin.com/in/jane-smith-123/?trk=abc")).toBe("https://www.linkedin.com/in/jane-smith-123");
    expect(canonicalLinkedIn("https://www.linkedin.com/in/jane-smith")).toBe("https://www.linkedin.com/in/jane-smith");
  });
});

describe("pickMatch", () => {
  const results = [
    { title: "Acme Ltd | LinkedIn", link: "https://www.linkedin.com/company/acme", position: 1 },
    { title: "Jane Smith - Head of Risk - Acme Ltd | LinkedIn", link: "https://uk.linkedin.com/in/jane-smith-99?trk=x", position: 2 },
  ];
  it("finds the profile match in the top results and parses the title", () => {
    expect(pickMatch(results, "Jane Smith", "Acme Ltd")).toEqual({
      link: "https://www.linkedin.com/in/jane-smith-99",
      jobTitle: "Head of Risk",
    });
  });
  it("returns null when no in/ profile in the top N matches the name", () => {
    expect(pickMatch(results, "Bob Jones", "Acme Ltd")).toBeNull();
    expect(pickMatch([results[0]!], "Jane Smith", "Acme Ltd")).toBeNull(); // only a company page
  });
});

describe("buildQuery", () => {
  it("quotes the name and appends the company", () => {
    expect(buildQuery("Jane Smith", "Acme Ltd")).toBe('site:linkedin.com/in "Jane Smith" Acme Ltd');
  });
});

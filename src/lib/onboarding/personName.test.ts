import { describe, it, expect } from "vitest";
import { parsePersonName, nameMatchKey, titleCaseName } from "./personName";

describe("parsePersonName", () => {
  it("de-shouts the Companies House officer format", () => {
    expect(parsePersonName("FELL, James Alexander")).toEqual({ first: "James", last: "Fell" });
  });
  it("handles natural order and drops a title", () => {
    expect(parsePersonName("Mr James Alexander Fell")).toEqual({ first: "James", last: "Fell" });
    expect(parsePersonName("James Fell")).toEqual({ first: "James", last: "Fell" });
  });
  it("keeps apostrophes and hyphens", () => {
    expect(parsePersonName("O'BRIEN, Sinead")).toEqual({ first: "Sinead", last: "O'Brien" });
    expect(parsePersonName("SMITH-JONES, Alex")).toEqual({ first: "Alex", last: "Smith-Jones" });
  });
  it("copes with a single token and empties", () => {
    expect(parsePersonName("Cher")).toEqual({ first: "Cher", last: "" });
    expect(parsePersonName("")).toEqual({ first: "", last: "" });
    expect(parsePersonName(null)).toEqual({ first: "", last: "" });
  });
});

describe("nameMatchKey", () => {
  it("is case-insensitive and matches across formats", () => {
    const fromOfficer = parsePersonName("FELL, James Alexander");
    const fromPsc = parsePersonName("Mr James Alexander Fell");
    expect(nameMatchKey(fromOfficer.first, fromOfficer.last)).toBe(nameMatchKey(fromPsc.first, fromPsc.last));
    expect(nameMatchKey("James", "Fell")).toBe("james|fell");
  });
});

describe("titleCaseName", () => {
  it("title-cases", () => {
    expect(titleCaseName("JAMES")).toBe("James");
    expect(titleCaseName("mcdonald")).toBe("Mcdonald");
  });
});

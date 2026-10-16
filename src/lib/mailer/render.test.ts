import { describe, it, expect } from "vitest";
import { renderTemplate, textToHtml } from "./render";

describe("renderTemplate", () => {
  it("fills first_name and company", () => {
    expect(renderTemplate("Hi {{first_name}} at {{company}}", { first_name: "Jane", company: "Lender Ltd" }))
      .toBe("Hi Jane at Lender Ltd");
  });
  it("falls back gracefully when vars are missing", () => {
    expect(renderTemplate("Hi {{first_name}}", { first_name: null })).toBe("Hi there");
    expect(renderTemplate("at {{ company }}", {})).toBe("at your team");
  });
  it("is case/space tolerant in the token", () => {
    expect(renderTemplate("{{First_Name}}", { first_name: "Sam" })).toBe("Sam");
  });
});

describe("textToHtml", () => {
  it("wraps paragraphs and line breaks", () => {
    expect(textToHtml("one\ntwo\n\nthree")).toBe("<p>one<br/>two</p>\n<p>three</p>");
  });
  it("escapes HTML so copy can't break markup", () => {
    expect(textToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});

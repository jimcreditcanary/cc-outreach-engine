import { describe, it, expect } from "vitest";
import { tagLinks } from "./tracking";

describe("tagLinks", () => {
  it("adds utm + cc_cid to a CC link", () => {
    const out = tagLinks("See https://www.creditcanary.co.uk/platform.html", { cid: "123", campaign: "q4" });
    expect(out).toContain("cc_cid=123");
    expect(out).toContain("utm_source=outreach");
    expect(out).toContain("utm_campaign=q4");
  });
  it("preserves an existing query string", () => {
    const out = tagLinks("https://creditcanary.co.uk/x?a=1", { cid: "9" });
    expect(out).toContain("a=1");
    expect(out).toContain("cc_cid=9");
  });
  it("doesn't swallow trailing sentence punctuation", () => {
    const out = tagLinks("read https://www.creditcanary.co.uk/platform.html.", { cid: "1" });
    expect(out.endsWith(".")).toBe(true);
    expect(out).toContain("platform.html?");
  });
  it("leaves non-CC links untouched", () => {
    expect(tagLinks("https://example.com/x", { cid: "1" })).toBe("https://example.com/x");
  });
});

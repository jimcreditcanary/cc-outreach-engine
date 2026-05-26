import { describe, it, expect } from "vitest";
import { checkAnonymisation } from "../anonymisation";

describe("checkAnonymisation", () => {
  it("passes a clean, properly-anonymised draft", () => {
    const r = checkAnonymisation(
      "We helped a tier 1 UK retail bank convert 40% of declines into approvals.",
    );
    expect(r.clean).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("rejects a draft naming TSB", () => {
    const r = checkAnonymisation("Like we did at TSB, we can rework your declines.");
    expect(r.clean).toBe(false);
    expect(r.hits).toContain("TSB");
  });

  it("rejects GMB and both NE First spellings", () => {
    expect(checkAnonymisation("GMB saw 28% more lending").hits).toContain("GMB Credit Union");
    expect(checkAnonymisation("NE First cut reviews to 5 min").hits).toContain("NE First Credit Union");
    expect(checkAnonymisation("NEFirst cut reviews to 5 min").hits).toContain("NE First Credit Union");
  });

  it("does not trip on substrings or unrelated words", () => {
    // GMBH, TSBank-like substrings must not match.
    const r = checkAnonymisation("Our GmbH partner and the outstanding results were strong.");
    expect(r.clean).toBe(true);
  });

  it("flags multiple leaks at once", () => {
    const r = checkAnonymisation("TSB and NE First both saw gains.");
    expect(r.clean).toBe(false);
    expect(r.hits.length).toBe(2);
  });
});

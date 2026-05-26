import { describe, it, expect } from "vitest";
import { classify } from "../classify";

describe("classify", () => {
  it("case studies", () => {
    expect(classify("https://www.creditcanary.co.uk/case-studies/tsb.html").type).toBe("case_study");
    expect(classify("/case-studies/gmb-credit-union.html").type).toBe("case_study");
  });

  it("blog → article", () => {
    expect(classify("/resources/blog/open-banking-only-scores").type).toBe("article");
    expect(classify("/resources/blog/ai-amplifier-not-foundation.html").type).toBe("article");
  });

  it("use-cases → article", () => {
    expect(classify("/use-cases/affordability-analysis.html").type).toBe("article");
  });

  it("platform → module with module tag", () => {
    const c = classify("/platform/decide.html");
    expect(c.type).toBe("module");
    expect(c.tags_module).toEqual(["decide"]);
  });

  it("connect → data_product", () => {
    expect(classify("/connect/open-banking.html").type).toBe("data_product");
  });

  it("audience → sector tag, no asset type", () => {
    const c = classify("/audience/credit-unions.html");
    expect(c.type).toBeNull();
    expect(c.tags_sector).toEqual(["credit_union"]);
  });

  it("platform/case-studies index pages are not mistaken for assets", () => {
    expect(classify("/resources/case-studies.html").type).toBeNull();
    expect(classify("/platform.html").type).toBeNull();
  });

  it("marketing pages → no type, no tags", () => {
    const c = classify("/about.html");
    expect(c.type).toBeNull();
    expect(c.tags_sector).toEqual([]);
    expect(c.tags_module).toEqual([]);
  });
});

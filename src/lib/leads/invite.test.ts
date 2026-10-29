import { describe, it, expect } from "vitest";
import { buildInviteEmail, sandboxUrl } from "./invite";

const BASE = { firstName: "Jane", company: "Lender Ltd", asset: "Risk & Liquidity", token: "tok_abc" };

describe("lead invite copy", () => {
  it("instant invite: subject, greeting, company, asset, and both links", () => {
    const e = buildInviteEmail("invite", BASE);
    expect(e.subject).toBe("Want a quick look at Credit Canary?");
    expect(e.textBody).toContain("Hi Jane,");
    expect(e.textBody).toContain("Lender Ltd");
    expect(e.textBody).toContain('grabbing "Risk & Liquidity"');
    expect(e.textBody).toContain("https://meetings-eu1.hubspot.com/jim-fell");
    expect(e.textBody).toContain("/api/leads/sandbox?token=tok_abc");
    // HTML carries the same two CTAs.
    expect(e.htmlBody).toContain("https://meetings-eu1.hubspot.com/jim-fell");
    expect(e.htmlBody).toContain("Just give me sandbox access");
  });

  it("falls back to 'your team' with no company and drops the asset clause", () => {
    const e = buildInviteEmail("invite", { firstName: "Sam", company: null, asset: null, token: "t" });
    expect(e.textBody).toContain("your team");
    expect(e.textBody).not.toContain("grabbing");
  });

  it("48h and 7d chases have their own subjects and keep both links", () => {
    const c48 = buildInviteEmail("chase_48h", BASE);
    expect(c48.subject).toBe("Still keen to see Credit Canary?");
    expect(c48.textBody).toContain("https://meetings-eu1.hubspot.com/jim-fell");
    expect(c48.textBody).toContain("/api/leads/sandbox?token=tok_abc");

    const c7 = buildInviteEmail("chase_7d", BASE);
    expect(c7.subject).toBe("Last one from me — Credit Canary");
    expect(c7.textBody).toContain("/api/leads/sandbox?token=tok_abc");
  });

  it("sandboxUrl is built on the app URL with the token", () => {
    expect(sandboxUrl("xyz")).toContain("/api/leads/sandbox?token=xyz");
  });
});

import { describe, it, expect } from "vitest";
import {
  splitName, fullName, humaniseEnum, fromHubspotContact, fromHubspotCompany, toHubspotContactProps,
} from "./mapping";

describe("humaniseEnum", () => {
  it("title-cases ALL_CAPS_UNDERSCORE enums", () => {
    expect(humaniseEnum("COMPUTER_SOFTWARE")).toBe("Computer Software");
    expect(humaniseEnum("ACCOUNTING")).toBe("Accounting");
  });
  it("leaves already-readable text and nulls untouched", () => {
    expect(humaniseEnum("Banking")).toBe("Banking");
    expect(humaniseEnum(null)).toBeNull();
  });
});

describe("splitName", () => {
  it("splits first and last", () => {
    expect(splitName("Jane Smith")).toEqual({ firstname: "Jane", lastname: "Smith" });
  });
  it("keeps everything after the first token as the surname", () => {
    expect(splitName("  Mary  Jane  Watson ")).toEqual({ firstname: "Mary", lastname: "Jane Watson" });
  });
  it("handles a single name", () => {
    expect(splitName("Cher")).toEqual({ firstname: "Cher" });
  });
  it("handles empty", () => {
    expect(splitName("   ")).toEqual({});
  });
});

describe("fullName", () => {
  it("joins first and last", () => expect(fullName("Jane", "Smith", null)).toBe("Jane Smith"));
  it("uses just the first when no last", () => expect(fullName("Jane", null, null)).toBe("Jane"));
  it("falls back to the email when no name", () => expect(fullName(null, null, "j@x.com")).toBe("j@x.com"));
  it("is empty when nothing is known", () => expect(fullName(null, null, null)).toBe(""));
});

describe("fromHubspotContact", () => {
  const base = {
    id: 123,
    properties: {
      email: "jane@lender.co.uk", firstname: "Jane", lastname: "Smith",
      jobtitle: "Head of Risk", mobilephone: "07700 900000",
      hs_lead_status: "NEW", email_status: "Verified",
      createdate: "2026-10-01T00:00:00Z", lastmodifieddate: "2026-10-02T00:00:00Z",
    },
  };

  it("maps core fields and the company", () => {
    const c = fromHubspotContact(base, { id: "999", name: "Lender Ltd" });
    expect(c).toMatchObject({
      id: "123", full_name: "Jane Smith", email: "jane@lender.co.uk",
      job_title: "Head of Risk", mobile: "07700 900000",
      company_id: "999", company_name: "Lender Ltd",
      is_new: true, lead_status: "NEW", email_guessed: false, email_bounced: false,
    });
    expect(c.url).toContain("/record/0-1/123");
  });

  it("flags guessed emails from email_status=Extrapolated", () => {
    const c = fromHubspotContact({ id: 1, properties: { email_status: "Extrapolated", email: "x@y.com" } });
    expect(c.email_guessed).toBe(true);
  });

  it("flags bounced from a hard-bounce reason", () => {
    const c = fromHubspotContact({ id: 1, properties: { hs_email_hard_bounce_reason_enum: "SPAM", email: "x@y.com" } });
    expect(c.email_bounced).toBe(true);
  });

  it("is_new only for hs_lead_status NEW", () => {
    expect(fromHubspotContact({ id: 1, properties: { hs_lead_status: "IN_PROGRESS" } }).is_new).toBe(false);
  });

  it("falls back mobile→phone and name→email", () => {
    const c = fromHubspotContact({ id: 1, properties: { email: "x@y.com", phone: "0161 000" } });
    expect(c.mobile).toBe("0161 000");
    expect(c.full_name).toBe("x@y.com");
  });
});

describe("fromHubspotCompany", () => {
  it("maps fields, website falls back to domain", () => {
    const co = fromHubspotCompany({ id: 55, properties: { name: "Lender Ltd", domain: "lender.co.uk", industry: "Banking" } });
    expect(co).toMatchObject({ id: "55", name: "Lender Ltd", domain: "lender.co.uk", website: "lender.co.uk", industry: "Banking" });
  });
});

describe("toHubspotContactProps", () => {
  it("splits full_name into first/last", () => {
    expect(toHubspotContactProps({ full_name: "Jane Smith" })).toMatchObject({ firstname: "Jane", lastname: "Smith" });
  });
  it("maps is_new → hs_lead_status", () => {
    expect(toHubspotContactProps({ is_new: true }).hs_lead_status).toBe("NEW");
    expect(toHubspotContactProps({ is_new: false }).hs_lead_status).toBe("IN_PROGRESS");
  });
  it("maps email_guessed → email_status", () => {
    expect(toHubspotContactProps({ email_guessed: true }).email_status).toBe("Extrapolated");
    expect(toHubspotContactProps({ email_guessed: false }).email_status).toBe("Verified");
  });
  it("only includes keys that were set (no clobber on update)", () => {
    expect(toHubspotContactProps({ job_title: "CRO" })).toEqual({ jobtitle: "CRO" });
  });
});

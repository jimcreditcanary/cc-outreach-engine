import { describe, expect, it } from "vitest";
import { parseSignature } from "../signature";

describe("parseSignature", () => {
  it("pulls a UK mobile, job title, and linkedin from a clean signature", () => {
    const body = `Hi Jim,

Thanks for the note — happy to chat next week.

Best,
Sarah Holmes
Head of Risk
Acme Lending
+44 7700 900123
https://www.linkedin.com/in/sarahholmes`;
    const sig = parseSignature(body);
    expect(sig.mobile).toBe("+44 7700 900123");
    expect(sig.job_title).toBe("Head of Risk");
    expect(sig.linkedin_url).toBe("https://www.linkedin.com/in/sarahholmes");
  });

  it("accepts 07xxx UK mobiles without country code", () => {
    const body = `Cheers,
James
Director, Acme
07700 900456`;
    expect(parseSignature(body).mobile).toBe("07700 900456");
  });

  it("ignores landlines (020 / 0161 area codes)", () => {
    const body = `regards
Alex
COO Acme Bank
020 7946 0000`;
    expect(parseSignature(body).mobile).toBe(null);
    expect(parseSignature(body).job_title).toBe("COO Acme Bank");
  });

  it("doesn't mine the quoted thread for sig data", () => {
    const body = `Yes that works.

On Tue, 4 Jun 2026 at 10:14, Jim <jim@creditcanary.co.uk> wrote:
> ...
> +44 7000 000000
> CEO, Credit Canary`;
    const sig = parseSignature(body);
    expect(sig.mobile).toBe(null);
    expect(sig.job_title).toBe(null);
  });

  it("rejects lines with digits when looking for job title", () => {
    const body = `Cheers,
Sam
Bought 5 widgets in Q3
07700 900789`;
    expect(parseSignature(body).job_title).toBe(null);
  });

  it("returns nulls on a body too short to plausibly carry a signature", () => {
    expect(parseSignature("Cheers")).toEqual({ mobile: null, job_title: null, linkedin_url: null });
  });
});

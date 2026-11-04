// Call Validate (TransUnion) adapter — UBO identity verification (ID&V) + PEP /
// sanctions screening. This provider is DESCOPED (no live contract wired, and we
// deliberately do NOT fabricate results): when it isn't configured, every check
// returns an explicit "unavailable" so an operator can never mistake a stubbed
// pass for a real verification. KYC is handled manually (document collection via
// the UBO upload link) until a provider is wired.
//
// Env (if ever wired): CALL_VALIDATE_USER + CALL_VALIDATE_PASSWORD.

export interface IdvPerson {
  firstName: string;
  lastName: string;
  dob?: string | null;              // YYYY-MM-DD
  address?: { line1?: string; line2?: string; city?: string; postcode?: string; country?: string };
}

export type IdvBand = "pass" | "refer" | "fail" | "unavailable";
export interface IdvResult {
  band: IdvBand;
  score: number;                    // 0–100 provider confidence
  verified: boolean;
  detail: Record<string, unknown>;
}

export interface ScreeningMatch { type: "pep" | "sanction"; name: string; detail?: string }
export interface ScreeningResult {
  pepMatch: boolean;
  sanctionsMatch: boolean;
  matches: ScreeningMatch[];
}

export interface CallValidateClient {
  verifyIdentity(person: IdvPerson): Promise<IdvResult>;
  screen(person: { firstName: string; lastName: string; dob?: string | null }): Promise<ScreeningResult>;
}

/** No provider wired — never fabricates. ID&V is "unavailable" (so it counts as
 *  not-verified and falls back to manual document collection); screening returns
 *  no matches but is explicitly flagged as not run. */
function unconfiguredClient(): CallValidateClient {
  return {
    async verifyIdentity() {
      return { band: "unavailable", score: 0, verified: false, detail: { configured: false, reason: "Identity verification is not configured." } };
    },
    async screen() {
      return { pepMatch: false, sanctionsMatch: false, matches: [] };
    },
  };
}

export function getCallValidate(): CallValidateClient {
  // Descoped: no live provider. Always the explicit "unavailable" client — never
  // a fabricated pass/fail. (Wire a real liveClient here if the contract lands.)
  return unconfiguredClient();
}

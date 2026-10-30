// Call Validate (TransUnion) adapter — UBO identity verification (ID&V) + PEP /
// sanctions screening. The live TransUnion contract (WSDL/endpoint) isn't wired
// yet, so the live client throws a clear "not configured" error that the
// orchestrator records as unavailable; the fixture mock drives the whole UBO-
// check flow meanwhile. Same shape as the CoP adapter.
//
// Env (live, once the contract is in hand): CALL_VALIDATE_USER + CALL_VALIDATE_PASSWORD.

import { useMock } from "./mock";

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

function liveClient(): CallValidateClient {
  const notWired = () => {
    throw new Error("Call Validate not wired yet — provide the TransUnion API contract + CALL_VALIDATE_USER/PASSWORD.");
  };
  return { verifyIdentity: notWired, screen: notWired };
}

function mockClient(): CallValidateClient {
  return {
    async verifyIdentity(person) {
      const hasAddress = Boolean(person.address?.postcode);
      const hasDob = Boolean(person.dob);
      // Fixture: full data → pass, partial → refer; a "fail" test name fails.
      if (person.lastName.toLowerCase().includes("fail")) {
        return { band: "fail", score: 20, verified: false, detail: { mock: true, reason: "no match" } };
      }
      if (hasAddress && hasDob) return { band: "pass", score: 92, verified: true, detail: { mock: true, sources: ["electoral_roll", "credit_header"] } };
      return { band: "refer", score: 55, verified: false, detail: { mock: true, reason: "insufficient data — need full DOB + address" } };
    },
    async screen(person) {
      const name = `${person.firstName} ${person.lastName}`.toLowerCase();
      const matches: ScreeningMatch[] = [];
      if (name.includes("pep")) matches.push({ type: "pep", name: `${person.firstName} ${person.lastName}`, detail: "Mock PEP list hit — verify manually." });
      if (name.includes("sanction")) matches.push({ type: "sanction", name: `${person.firstName} ${person.lastName}`, detail: "Mock sanctions list hit — verify manually." });
      return { pepMatch: matches.some((m) => m.type === "pep"), sanctionsMatch: matches.some((m) => m.type === "sanction"), matches };
    },
  };
}

export function getCallValidate(): CallValidateClient {
  const hasCreds = Boolean(process.env.CALL_VALIDATE_USER && process.env.CALL_VALIDATE_PASSWORD);
  return useMock("callValidate", hasCreds) ? mockClient() : liveClient();
}

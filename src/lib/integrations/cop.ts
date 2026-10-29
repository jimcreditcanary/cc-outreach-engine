// Confirmation of Payee (CoP) adapter — checks an account name matches the
// sort code + account number before we pay out to it. The PSP is still TBD
// (Modulr / ClearBank / Form3), so the live client isn't wired yet: it throws a
// clear "not configured" error, which callers catch and record as "unavailable".
// The fixture mock lets the whole merchant flow run end-to-end meanwhile.
//
// Env (live, once a PSP is chosen): COP_PROVIDER + COP_API_KEY.

import { useMock } from "./mock";

export type CopResult = "match" | "close_match" | "no_match" | "unavailable";

export interface CopInput {
  sortCode: string;
  accountNumber: string;
  name: string;
  accountType?: "personal" | "business";
}
export interface CopCheck {
  result: CopResult;
  matchedName: string | null;
  reason?: string;
}

export interface CopClient {
  check(input: CopInput): Promise<CopCheck>;
}

function liveClient(): CopClient {
  return {
    async check() {
      // No PSP wired yet — surface it so the caller records "unavailable".
      throw new Error("CoP provider not configured (set COP_PROVIDER + COP_API_KEY once a PSP is chosen).");
    },
  };
}

function mockClient(): CopClient {
  return {
    async check(input) {
      // Deterministic fixture: a clearly-personal test name near-matches, else full match.
      const name = input.name.trim().toLowerCase();
      if (!input.sortCode || !input.accountNumber) return { result: "unavailable", matchedName: null, reason: "missing details" };
      if (name.includes("mismatch")) return { result: "no_match", matchedName: "SOMEONE ELSE LTD" };
      if (name.includes("close")) return { result: "close_match", matchedName: `${input.name} LIMITED` };
      return { result: "match", matchedName: input.name };
    },
  };
}

export function getCop(): CopClient {
  const hasCreds = Boolean(process.env.COP_API_KEY && process.env.COP_PROVIDER);
  return useMock("cop", hasCreds) ? mockClient() : liveClient();
}

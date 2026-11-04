// Confirmation of Payee (CoP) adapter — checks an account name matches the
// sort code + account number before we pay out to it. DESCOPED: no PSP wired and
// we deliberately do NOT fabricate a match. When unconfigured, every check
// returns "unavailable" so an operator never sees a stubbed "match" on a real
// account. Account details are still captured (encrypted) for manual checks.
//
// Env (if ever wired): COP_PROVIDER + COP_API_KEY.

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

/** No PSP wired — never fabricates a match; every check is "unavailable". */
function unconfiguredClient(): CopClient {
  return {
    async check() {
      return { result: "unavailable", matchedName: null, reason: "Confirmation of Payee is not configured." };
    },
  };
}

export function getCop(): CopClient {
  // Descoped: no live PSP. Always "unavailable" — never a fabricated match.
  return unconfiguredClient();
}

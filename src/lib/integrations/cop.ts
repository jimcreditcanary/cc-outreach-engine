// Confirmation of Payee (CoP) adapter — checks an account name matches the sort
// code + account number before we pay out to it. Live provider is the Credit
// Canary / whoamipaying CoP API. When COP_API_KEY is unset it returns
// "unavailable" (never a fabricated match), so an operator never sees a stubbed
// result on a real account.
//
// Env (live): COP_API_KEY. Endpoint: POST {COP_API_URL|whoamipaying}/api/v1/cop.

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

/** No key — never fabricates a match; every check is "unavailable". */
function unconfiguredClient(): CopClient {
  return {
    async check() {
      return { result: "unavailable", matchedName: null, reason: "Confirmation of Payee is not configured." };
    },
  };
}

interface CopApiResponse {
  result?: {
    cop_result?: string;            // FULL_MATCH | PARTIAL_MATCH | NO_MATCH | ...
    cop_reason?: string;
    account_type_match?: boolean;
    returned_customer_name?: string | null;
    error?: string | null;
  };
}

/** Live client against the whoamipaying CoP API (Bearer auth). */
function liveClient(key: string): CopClient {
  const base = (process.env.COP_API_URL || "https://www.whoamipaying.co.uk").replace(/\/$/, "");
  return {
    async check(input) {
      if (!input.sortCode || !input.accountNumber) return { result: "unavailable", matchedName: null, reason: "missing account details" };
      try {
        const res = await fetch(`${base}/api/v1/cop`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            account_name: input.name,
            sort_code: input.sortCode,
            account_number: input.accountNumber,
            account_type: input.accountType === "personal" ? "Personal" : "Business",
          }),
        });
        if (!res.ok) return { result: "unavailable", matchedName: null, reason: `CoP API ${res.status}` };
        const j = (await res.json()) as CopApiResponse;
        const r = j.result;
        if (!r || r.error) return { result: "unavailable", matchedName: null, reason: r?.error ?? "no result" };
        const matchedName = r.returned_customer_name ?? null;
        // A name match on the WRONG account type is not a valid confirmation —
        // downgrade it so it never shows as a clean "match".
        const typeOk = r.account_type_match !== false;
        const raw = (r.cop_result ?? "").toUpperCase();
        let result: CopResult =
          raw.includes("FULL") ? "match"
          : raw.includes("PARTIAL") ? "close_match"
          : raw.includes("NO_MATCH") || raw.includes("NO MATCH") ? "no_match"
          : "unavailable";
        if (!typeOk && result === "match") result = "close_match";
        return { result, matchedName, reason: !typeOk ? "account type mismatch" : r.cop_reason };
      } catch (e) {
        return { result: "unavailable", matchedName: null, reason: `CoP error: ${(e as Error).message}` };
      }
    },
  };
}

export function getCop(): CopClient {
  const key = process.env.COP_API_KEY;
  return key ? liveClient(key) : unconfiguredClient();
}

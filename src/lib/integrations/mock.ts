// Mock selection for external integrations. companiesHouse / drive / xero use a
// fixture mock so the pipeline runs before a real key is in place.
//
// NOTE: the KYC/CoP/address providers (callValidate, cop, postcoder) are DESCOPED
// and no longer mocked — rather than fabricate a pass/match/address they return
// an explicit "unavailable"/empty result (see those adapters). They ignore
// INTEGRATIONS_MOCK.
//
// An integration uses its mock when EITHER:
//   • INTEGRATIONS_MOCK names it ("all", or a comma list e.g. "companiesHouse")
//   • its own credentials are absent (hasCreds=false) — so dev works out of the box
//
// Set INTEGRATIONS_MOCK=all in dev/staging to force every mocked adapter to its mock.

export type IntegrationName =
  | "companiesHouse"
  | "cop"
  | "callValidate"
  | "postcoder"
  | "drive"
  | "charityCommission"
  | "sanctions"
  | "fcaRegister"
  | "xero";

function mockList(): Set<string> {
  return new Set(
    (process.env.INTEGRATIONS_MOCK ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** True when `name` should use its mock implementation. `hasCreds=false`
 *  auto-mocks (no key configured yet); an explicit INTEGRATIONS_MOCK entry
 *  (or "all") forces the mock even when creds exist. */
export function useMock(name: IntegrationName, hasCreds: boolean): boolean {
  const list = mockList();
  if (list.has("all") || list.has(name)) return true;
  return !hasCreds;
}

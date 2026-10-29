// Mock selection for external integrations (onboarding brief, non-negotiables).
// Every integration (companiesHouse, cop, callValidate, postcoder, drive,
// charityCommission, sanctions, fcaRegister) exposes a typed interface with a
// live client and a mock, and picks between them here — so the whole pipeline
// runs end-to-end before any real key/credential is in place.
//
// An integration uses its mock when EITHER:
//   • INTEGRATIONS_MOCK names it ("all", or a comma list e.g. "companiesHouse,cop")
//   • its own credentials are absent (hasCreds=false) — so dev works out of the box
//
// Set INTEGRATIONS_MOCK=all in dev/staging to force every adapter to its mock.

export type IntegrationName =
  | "companiesHouse"
  | "cop"
  | "callValidate"
  | "postcoder"
  | "drive"
  | "charityCommission"
  | "sanctions"
  | "fcaRegister";

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

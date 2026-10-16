// The one place the app resolves which CRM backend is live. Pages/actions call
// getCrm() and depend only on the CrmRepository interface — so flipping the
// source of truth (or dual-running for parity) is a change here, not in the UI.
//
//   CRM_BACKEND = "hubspot" (default once the token is set) | "supabase"
//
// Today only the HubSpot backend exists; the Supabase adapter (wrapping the
// current queries behind the same interface) lands when we parity-test P2.

import { hubspotEnabled } from "../hubspot/client";
import { hubspotRepo } from "../hubspot/repo";
import type { CrmRepository } from "./types";

export type CrmBackend = "hubspot" | "supabase";

export function activeBackend(): CrmBackend {
  const explicit = process.env.CRM_BACKEND as CrmBackend | undefined;
  if (explicit === "hubspot" || explicit === "supabase") return explicit;
  return hubspotEnabled() ? "hubspot" : "supabase";
}

export function getCrm(): CrmRepository {
  switch (activeBackend()) {
    case "hubspot":
      return hubspotRepo;
    case "supabase":
      // TODO(P2): return supabaseRepo for dual-run parity checks.
      throw new Error("CRM_BACKEND=supabase: the Supabase CRM adapter isn't built yet (P2).");
  }
}

export type { CrmRepository } from "./types";
export * from "./types";

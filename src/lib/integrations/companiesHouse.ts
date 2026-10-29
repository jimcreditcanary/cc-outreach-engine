// Companies House adapter. Phase 1 needs company search + profile (wizard step 1:
// confirm the company behind a deal). Phase 2 extends this same client with
// officers, PSCs, filing history, charges, insolvency, the Document API + iXBRL
// accounts parse, and the disqualified-officers register.
//
// Live calls hit the CH REST API (HTTP Basic: API key as username, blank
// password). A fixture-backed mock stands in when no key is set or when
// INTEGRATIONS_MOCK selects it (see ./mock.ts), so the wizard runs end-to-end
// before COMPANIES_HOUSE_API_KEY is provisioned.

import { useMock } from "./mock";

const BASE = "https://api.company-information.service.gov.uk";

export class CompaniesHouseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CompaniesHouseError";
  }
}

export interface ChAddress {
  premises?: string;
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

export interface ChPreviousName {
  name: string;
  effective_from?: string;
  ceased_on?: string;
}

export interface ChCompanySearchResult {
  company_number: string;
  title: string;
  company_status: string | null;
  company_type: string | null;
  address_snippet: string | null;
  date_of_creation: string | null;
}

/** Profile-level fields (the /company/{number} response). Officers, PSCs,
 *  charges and insolvency detail are separate endpoints added in Phase 2. */
export interface ChCompanyProfile {
  company_number: string;
  company_name: string;
  company_status: string | null;
  company_status_detail: string | null;
  type: string | null;
  jurisdiction: string | null;
  date_of_creation: string | null;
  sic_codes: string[];
  registered_office_address: ChAddress | null;
  previous_company_names: ChPreviousName[];
  accounts: {
    next_due: string | null;
    last_made_up_to: string | null;
    overdue: boolean;
  } | null;
  confirmation_statement: {
    next_due: string | null;
    last_made_up_to: string | null;
    overdue: boolean;
  } | null;
  has_charges: boolean;
  has_insolvency_history: boolean;
  /** The untouched CH response, stored on the snapshot in Phase 2. */
  raw: unknown;
}

export interface CompaniesHouseClient {
  searchCompanies(query: string, limit?: number): Promise<ChCompanySearchResult[]>;
  /** Null when CH has no company with that number (404). */
  getProfile(companyNumber: string): Promise<ChCompanyProfile | null>;
}

// ─── live client ──────────────────────────────────────────────────────────────

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function chFetch(path: string, key: string): Promise<Response> {
  // CH rate limit is 600 req / 5 min. Retry transient throttles / 5xx a couple
  // of times with backoff; surface everything else as a typed error.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: authHeader(key), Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  throw new CompaniesHouseError(`network error: ${(lastErr as Error)?.message ?? "unknown"}`, 0);
}

function mapProfile(j: Record<string, unknown>): ChCompanyProfile {
  const accounts = j.accounts as Record<string, unknown> | undefined;
  const cs = j.confirmation_statement as Record<string, unknown> | undefined;
  const lastAccounts = accounts?.last_accounts as Record<string, unknown> | undefined;
  return {
    company_number: String(j.company_number ?? ""),
    company_name: String(j.company_name ?? ""),
    company_status: (j.company_status as string) ?? null,
    company_status_detail: (j.company_status_detail as string) ?? null,
    type: (j.type as string) ?? null,
    jurisdiction: (j.jurisdiction as string) ?? null,
    date_of_creation: (j.date_of_creation as string) ?? null,
    sic_codes: Array.isArray(j.sic_codes) ? (j.sic_codes as string[]) : [],
    registered_office_address: (j.registered_office_address as ChAddress) ?? null,
    previous_company_names: Array.isArray(j.previous_company_names)
      ? (j.previous_company_names as ChPreviousName[])
      : [],
    accounts: accounts
      ? {
          next_due: (accounts.next_due as string) ?? null,
          last_made_up_to: (lastAccounts?.made_up_to as string) ?? null,
          overdue: Boolean(accounts.overdue),
        }
      : null,
    confirmation_statement: cs
      ? {
          next_due: (cs.next_due as string) ?? null,
          last_made_up_to: (cs.last_made_up_to as string) ?? null,
          overdue: Boolean(cs.overdue),
        }
      : null,
    has_charges: Boolean(j.has_charges),
    has_insolvency_history: Boolean(j.has_insolvency_history),
    raw: j,
  };
}

function liveClient(key: string): CompaniesHouseClient {
  return {
    async searchCompanies(query, limit = 20) {
      const res = await chFetch(`/search/companies?q=${encodeURIComponent(query)}&items_per_page=${limit}`, key);
      if (!res.ok) throw new CompaniesHouseError(`search failed: ${res.status}`, res.status);
      const j = (await res.json()) as { items?: Record<string, unknown>[] };
      return (j.items ?? []).map((it) => ({
        company_number: String(it.company_number ?? ""),
        title: String(it.title ?? ""),
        company_status: (it.company_status as string) ?? null,
        company_type: (it.company_type as string) ?? null,
        address_snippet: (it.address_snippet as string) ?? null,
        date_of_creation: (it.date_of_creation as string) ?? null,
      }));
    },
    async getProfile(companyNumber) {
      const res = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}`, key);
      if (res.status === 404) return null;
      if (!res.ok) throw new CompaniesHouseError(`profile failed: ${res.status}`, res.status);
      return mapProfile((await res.json()) as Record<string, unknown>);
    },
  };
}

// ─── mock client (fixture: Pozitive Energy Ltd, from the reference form) ───────

const MOCK_PROFILE: ChCompanyProfile = {
  company_number: "09523048",
  company_name: "POZITIVE ENERGY LTD",
  company_status: "active",
  company_status_detail: null,
  type: "ltd",
  jurisdiction: "england-wales",
  date_of_creation: "2015-04-01",
  sic_codes: ["35140"],
  registered_office_address: {
    premises: "One Canada Square",
    address_line_1: "Canary Wharf, Floor 10 (North West)",
    locality: "London",
    postal_code: "E14 5AB",
    country: "England",
  },
  previous_company_names: [
    { name: "TORNADO ENERGY SUPPLY LIMITED", ceased_on: "2016-05-16" },
  ],
  accounts: { next_due: "2026-12-31", last_made_up_to: "2025-03-31", overdue: false },
  confirmation_statement: { next_due: "2026-11-28", last_made_up_to: "2025-11-14", overdue: false },
  has_charges: false,
  has_insolvency_history: false,
  raw: { mock: true },
};

function mockClient(): CompaniesHouseClient {
  return {
    async searchCompanies(query) {
      const q = query.trim().toLowerCase();
      const hit =
        q === "" ||
        MOCK_PROFILE.company_number.includes(q) ||
        MOCK_PROFILE.company_name.toLowerCase().includes(q);
      return hit
        ? [
            {
              company_number: MOCK_PROFILE.company_number,
              title: MOCK_PROFILE.company_name,
              company_status: MOCK_PROFILE.company_status,
              company_type: MOCK_PROFILE.type,
              address_snippet: "One Canada Square, Canary Wharf, London, E14 5AB",
              date_of_creation: MOCK_PROFILE.date_of_creation,
            },
          ]
        : [];
    },
    async getProfile(companyNumber) {
      // Dev convenience: return the fixture for any number so the wizard runs.
      return { ...MOCK_PROFILE, company_number: companyNumber.trim() || MOCK_PROFILE.company_number };
    },
  };
}

export function getCompaniesHouse(): CompaniesHouseClient {
  // Jim's live key in Vercel is COMPANIES_HOUSE_API; accept the _KEY alias too.
  const key = process.env.COMPANIES_HOUSE_API ?? process.env.COMPANIES_HOUSE_API_KEY;
  return useMock("companiesHouse", Boolean(key)) ? mockClient() : liveClient(key!);
}

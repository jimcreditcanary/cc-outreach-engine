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

export interface ChDob { month?: number; year?: number }

export interface ChOfficer {
  /** links.self — stable appointment id, our dedupe key. */
  appointment_id: string | null;
  name: string;
  officer_role: string | null;
  appointed_on: string | null;
  /** Null for a current officer. */
  resigned_on: string | null;
  nationality: string | null;
  occupation: string | null;
  country_of_residence: string | null;
  date_of_birth: ChDob | null;
  address: ChAddress | null;
  raw: unknown;
}

export interface ChPsc {
  /** individual-…/corporate-entity-…/legal-person-… or a "…-statement". */
  kind: string;
  name: string | null;
  natures_of_control: string[];
  notified_on: string | null;
  ceased_on: string | null;
  nationality: string | null;
  country_of_residence: string | null;
  date_of_birth: ChDob | null;
  address: ChAddress | null;
  /** Corporate PSC registration detail (company number, place registered, …). */
  identification: Record<string, unknown> | null;
  raw: unknown;
}

export interface ChChargesSummary { total: number; outstanding: number }
export interface ChInsolvencySummary { cases: number; raw: unknown }

export interface ChDisqualifiedMatch {
  name: string;
  /** links.self of the disqualified-officer record (for human verification). */
  officer_id: string | null;
  description: string | null;
  raw: unknown;
}

export interface ChAccountsDocument {
  /** The iXBRL (XHTML) document text. */
  ixbrl: string;
  /** The accounts made-up-to / filing date, if known. */
  madeUpTo: string | null;
}

export interface CompaniesHouseClient {
  searchCompanies(query: string, limit?: number): Promise<ChCompanySearchResult[]>;
  /** Null when CH has no company with that number (404). */
  getProfile(companyNumber: string): Promise<ChCompanyProfile | null>;
  /** Latest filed accounts as iXBRL (via filing history → Document API). Null
   *  when there are no iXBRL accounts (P2b). */
  getAccountsDocument(companyNumber: string): Promise<ChAccountsDocument | null>;
  /** All officers (caller filters current + resigned ≤12mo). */
  getOfficers(companyNumber: string): Promise<ChOfficer[]>;
  /** Persons with significant control (direct — caller recurses corporates). */
  getPscs(companyNumber: string): Promise<ChPsc[]>;
  getCharges(companyNumber: string): Promise<ChChargesSummary>;
  /** Null when CH has no insolvency record (404). */
  getInsolvency(companyNumber: string): Promise<ChInsolvencySummary | null>;
  /** Fuzzy name search of the disqualified-officers register. */
  searchDisqualified(name: string): Promise<ChDisqualifiedMatch[]>;
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

/** Fetch an absolute CH URL (the Document API lives on another host) with Basic
 *  auth + the same retry. accept drives the representation (iXBRL vs metadata). */
async function chFetchUrl(url: string, key: string, accept = "application/json"): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: authHeader(key), Accept: accept } });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue; }
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

function mapDob(v: unknown): ChDob | null {
  const d = v as { month?: number; year?: number } | undefined;
  return d && (d.month || d.year) ? { month: d.month, year: d.year } : null;
}

function mapOfficer(it: Record<string, unknown>): ChOfficer {
  const links = it.links as { self?: string } | undefined;
  return {
    appointment_id: links?.self ?? null,
    name: String(it.name ?? ""),
    officer_role: (it.officer_role as string) ?? null,
    appointed_on: (it.appointed_on as string) ?? null,
    resigned_on: (it.resigned_on as string) ?? null,
    nationality: (it.nationality as string) ?? null,
    occupation: (it.occupation as string) ?? null,
    country_of_residence: (it.country_of_residence as string) ?? null,
    date_of_birth: mapDob(it.date_of_birth),
    address: (it.address as ChAddress) ?? null,
    raw: it,
  };
}

function mapPsc(it: Record<string, unknown>): ChPsc {
  return {
    kind: String(it.kind ?? ""),
    name: (it.name as string) ?? null,
    natures_of_control: Array.isArray(it.natures_of_control) ? (it.natures_of_control as string[]) : [],
    notified_on: (it.notified_on as string) ?? null,
    ceased_on: (it.ceased_on as string) ?? null,
    nationality: (it.nationality as string) ?? null,
    country_of_residence: (it.country_of_residence as string) ?? null,
    date_of_birth: mapDob(it.date_of_birth),
    address: (it.address as ChAddress) ?? null,
    identification: (it.identification as Record<string, unknown>) ?? null,
    raw: it,
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
    async getAccountsDocument(companyNumber) {
      // filing history → latest accounts filing → Document API metadata → iXBRL content.
      const hist = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}/filing-history?category=accounts&items_per_page=10`, key);
      if (!hist.ok) return null;
      const j = (await hist.json()) as { items?: { date?: string; action_date?: string; links?: { document_metadata?: string } }[] };
      const item = (j.items ?? []).find((it) => it.links?.document_metadata);
      const metaUrl = item?.links?.document_metadata;
      if (!metaUrl) return null;
      const metaRes = await chFetchUrl(metaUrl, key);
      if (!metaRes.ok) return null;
      const meta = (await metaRes.json()) as { resources?: Record<string, unknown> };
      if (!meta.resources || !meta.resources["application/xhtml+xml"]) return null; // no iXBRL (e.g. micro-entity PDF only)
      const contentRes = await chFetchUrl(`${metaUrl}/content`, key, "application/xhtml+xml");
      if (!contentRes.ok) return null;
      const ixbrl = await contentRes.text();
      if (!ixbrl || ixbrl.length < 200) return null;
      return { ixbrl, madeUpTo: item!.action_date ?? item!.date ?? null };
    },
    async getOfficers(companyNumber) {
      const res = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}/officers?items_per_page=100`, key);
      if (res.status === 404) return [];
      if (!res.ok) throw new CompaniesHouseError(`officers failed: ${res.status}`, res.status);
      const j = (await res.json()) as { items?: Record<string, unknown>[] };
      return (j.items ?? []).map(mapOfficer);
    },
    async getPscs(companyNumber) {
      const res = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}/persons-with-significant-control?items_per_page=100`, key);
      if (res.status === 404) return [];
      if (!res.ok) throw new CompaniesHouseError(`psc failed: ${res.status}`, res.status);
      const j = (await res.json()) as { items?: Record<string, unknown>[] };
      return (j.items ?? []).map(mapPsc);
    },
    async getCharges(companyNumber) {
      const res = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}/charges?items_per_page=100`, key);
      if (res.status === 404) return { total: 0, outstanding: 0 };
      if (!res.ok) throw new CompaniesHouseError(`charges failed: ${res.status}`, res.status);
      const j = (await res.json()) as { total_count?: number; items?: { status?: string }[] };
      const items = j.items ?? [];
      return { total: j.total_count ?? items.length, outstanding: items.filter((i) => i.status === "outstanding").length };
    },
    async getInsolvency(companyNumber) {
      const res = await chFetch(`/company/${encodeURIComponent(companyNumber.trim())}/insolvency`, key);
      if (res.status === 404) return null;
      if (!res.ok) throw new CompaniesHouseError(`insolvency failed: ${res.status}`, res.status);
      const j = (await res.json()) as { cases?: unknown[] };
      return { cases: Array.isArray(j.cases) ? j.cases.length : 0, raw: j };
    },
    async searchDisqualified(name) {
      // Best-effort — never fail the enrichment on a register search.
      const res = await chFetch(`/search/disqualified-officers?q=${encodeURIComponent(name)}&items_per_page=20`, key);
      if (!res.ok) return [];
      const j = (await res.json()) as { items?: Record<string, unknown>[] };
      return (j.items ?? []).map((it) => ({
        name: String(it.title ?? name),
        officer_id: ((it.links as { self?: string } | undefined)?.self) ?? null,
        description: (it.description as string) ?? null,
        raw: it,
      }));
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

// Compact iXBRL fixture so the P2b accounts flow runs end-to-end on the mock.
const MOCK_IXBRL = `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance">
<ix:header><ix:resources>
<xbrli:context id="dur"><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="inst"><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>
</ix:resources></ix:header><body>
<ix:nonFraction name="core:TurnoverRevenue" contextRef="dur" unitRef="GBP" scale="0">4820000</ix:nonFraction>
<ix:nonFraction name="core:ProfitLoss" contextRef="dur" unitRef="GBP" scale="0">612000</ix:nonFraction>
<ix:nonFraction name="core:NetAssetsLiabilities" contextRef="inst" unitRef="GBP" scale="0">1890000</ix:nonFraction>
<ix:nonFraction name="core:CashBankOnHand" contextRef="inst" unitRef="GBP" scale="0">540000</ix:nonFraction>
<ix:nonFraction name="core:AverageNumberEmployeesDuringPeriod" contextRef="dur" unitRef="pure">38</ix:nonFraction>
</body></html>`;

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
    async getAccountsDocument() {
      return { ixbrl: MOCK_IXBRL, madeUpTo: "2025-03-31" };
    },
    async getOfficers() {
      return [
        {
          appointment_id: "/officers/mock-active/appointments", name: "SMITH, Jane",
          officer_role: "director", appointed_on: "2015-04-01", resigned_on: null,
          nationality: "British", occupation: "Director", country_of_residence: "England",
          date_of_birth: { month: 6, year: 1980 },
          address: { address_line_1: "One Canada Square", locality: "London", postal_code: "E14 5AB", country: "England" },
          raw: { mock: true },
        },
        {
          appointment_id: "/officers/mock-resigned/appointments", name: "JONES, Robert",
          officer_role: "director", appointed_on: "2016-01-10", resigned_on: "2026-06-30",
          nationality: "British", occupation: "Director", country_of_residence: "England",
          date_of_birth: { month: 3, year: 1975 }, address: null, raw: { mock: true },
        },
      ];
    },
    async getPscs() {
      return [
        {
          kind: "individual-person-with-significant-control", name: "SMITH, Jane",
          natures_of_control: ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent"],
          notified_on: "2016-04-06", ceased_on: null, nationality: "British",
          country_of_residence: "England", date_of_birth: { month: 6, year: 1980 },
          address: { locality: "London", postal_code: "E14 5AB", country: "England" },
          identification: null, raw: { mock: true },
        },
      ];
    },
    async getCharges() { return { total: 0, outstanding: 0 }; },
    async getInsolvency() { return null; },
    async searchDisqualified() { return []; },
  };
}

export function getCompaniesHouse(): CompaniesHouseClient {
  // Jim's live key in Vercel is COMPANIES_HOUSE_API; accept the _KEY alias too.
  const key = process.env.COMPANIES_HOUSE_API ?? process.env.COMPANIES_HOUSE_API_KEY;
  return useMock("companiesHouse", Boolean(key)) ? mockClient() : liveClient(key!);
}

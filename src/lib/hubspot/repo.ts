// HubSpot implementation of CrmRepository. Reads go through the Search API
// (gives total + sort + paging in one call); associated company names are
// resolved with batch association + batch company reads (2 extra calls per
// page, not N+1). Writes are contacts-only for now — matching what P0 proved.
//
// Known scaffold limitations (tracked for later, see docs/HUBSPOT_MIGRATION.md):
//  - Free-text `q` uses HubSpot's contact search, which matches the contact's
//    `company` text property, not the associated company object's name. Matching
//    by associated-company name needs the name→ids→association-filter dance
//    (as in src/lib/contacts/search.ts); deferred.
//  - Search API can't page beyond the 10k-result window — fine for browsing,
//    a nudge toward the read-mirror for full-base operations.

import { hsFetch, invalidateCache, recordUrl } from "./client";
import {
  CONTACT_READ_PROPS, COMPANY_READ_PROPS, DEAL_READ_PROPS,
  fromHubspotContact, fromHubspotCompany, fromHubspotDeal,
  toHubspotContactProps, toHubspotCompanyProps,
} from "./mapping";
import type {
  CrmRepository, ContactRecord, CompanyRecord, DealRecord, ContactWrite, CompanyWrite,
  ListContactsOpts, ListCompaniesOpts, ListDealsOpts, Page,
} from "../crm/types";

const READ_TTL = Number(process.env.HUBSPOT_CACHE_TTL_MS ?? 15_000);

interface HsObj { id: string | number; properties: Record<string, string | null | undefined>; }
interface SearchResponse { total: number; results: HsObj[]; paging?: { next?: { after?: string } }; }

const CONTACT_SORT: Record<string, string> = {
  full_name: "lastname", job_title: "jobtitle", email: "email", created_at: "createdate",
};
const COMPANY_SORT: Record<string, string> = {
  name: "name", industry: "industry", created_at: "createdate",
};

interface SearchBody {
  query?: string;
  filterGroups?: { filters: { propertyName: string; operator: string; value?: string; values?: string[] }[] }[];
  sorts?: { propertyName: string; direction: "ASCENDING" | "DESCENDING" }[];
  properties: string[];
  limit: number;
  after?: string;
}

function search(objectType: string, body: SearchBody): Promise<SearchResponse> {
  return hsFetch<SearchResponse>(`/crm/v3/objects/${objectType}/search`, {
    method: "POST", body, cacheTtl: READ_TTL,
  });
}

// contactId → primary associated companyId (one batch call).
async function contactCompanyIds(contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (contactIds.length === 0) return out;
  const res = await hsFetch<{ results: { from: { id: string }; to: { toObjectId: string | number }[] }[] }>(
    `/crm/v4/associations/contacts/companies/batch/read`,
    { method: "POST", body: { inputs: contactIds.map((id) => ({ id })) }, cacheTtl: READ_TTL },
  );
  for (const r of res.results ?? []) {
    const first = r.to?.[0];
    if (first) out.set(String(r.from.id), String(first.toObjectId));
  }
  return out;
}

// companyId → name (one batch call).
async function companyNames(companyIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(companyIds)];
  if (unique.length === 0) return out;
  const res = await hsFetch<{ results: HsObj[] }>(
    `/crm/v3/objects/companies/batch/read`,
    { method: "POST", body: { properties: ["name"], inputs: unique.map((id) => ({ id })) }, cacheTtl: READ_TTL },
  );
  for (const c of res.results ?? []) {
    const name = (c.properties?.name ?? "").trim();
    out.set(String(c.id), name || null);
  }
  return out;
}

async function attachCompanies(contacts: HsObj[]): Promise<ContactRecord[]> {
  const ids = contacts.map((c) => String(c.id));
  const byContact = await contactCompanyIds(ids);
  const names = await companyNames([...byContact.values()]);
  return contacts.map((c) => {
    const companyId = byContact.get(String(c.id)) ?? null;
    const company = companyId ? { id: companyId, name: names.get(companyId) ?? null } : null;
    return fromHubspotContact(c, company);
  });
}

export const hubspotRepo: CrmRepository = {
  async listContacts(opts: ListContactsOpts): Promise<Page<ContactRecord>> {
    const limit = Math.min(opts.limit ?? 100, 200);
    const sortCol = opts.sort?.col ?? "full_name";
    const body: SearchBody = {
      properties: [...CONTACT_READ_PROPS],
      limit,
      after: opts.after,
      sorts: [{
        propertyName: CONTACT_SORT[sortCol] ?? "lastname",
        direction: (opts.sort?.dir ?? "asc") === "asc" ? "ASCENDING" : "DESCENDING",
      }],
    };
    if (opts.q?.trim()) body.query = opts.q.trim();
    if (opts.newOnly) body.filterGroups = [{ filters: [{ propertyName: "hs_lead_status", operator: "EQ", value: "NEW" }] }];

    const res = await search("contacts", body);
    return {
      records: await attachCompanies(res.results ?? []),
      total: res.total ?? 0,
      after: res.paging?.next?.after,
    };
  },

  async getContact(id: string): Promise<ContactRecord | null> {
    try {
      const obj = await hsFetch<HsObj & { associations?: { companies?: { results?: { id: string | number }[] } } }>(
        `/crm/v3/objects/contacts/${id}?properties=${CONTACT_READ_PROPS.join(",")}&associations=companies`,
        { cacheTtl: READ_TTL },
      );
      const companyId = obj.associations?.companies?.results?.[0]?.id;
      let company: { id: string; name: string | null } | null = null;
      if (companyId != null) {
        const names = await companyNames([String(companyId)]);
        company = { id: String(companyId), name: names.get(String(companyId)) ?? null };
      }
      return fromHubspotContact(obj, company);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  },

  async createContact(input: ContactWrite): Promise<ContactRecord> {
    const created = await hsFetch<HsObj>(`/crm/v3/objects/contacts`, {
      method: "POST", body: { properties: toHubspotContactProps(input) },
    });
    const id = String(created.id);
    if (input.company_id) await setContactCompany(id, input.company_id);
    invalidateCache();
    return (await this.getContact(id)) ?? fromHubspotContact(created);
  },

  async updateContact(id: string, patch: ContactWrite): Promise<ContactRecord> {
    const props = toHubspotContactProps(patch);
    if (Object.keys(props).length > 0) {
      await hsFetch<HsObj>(`/crm/v3/objects/contacts/${id}`, { method: "PATCH", body: { properties: props } });
    }
    if (patch.company_id) await setContactCompany(id, patch.company_id);
    invalidateCache();
    return (await this.getContact(id))!;
  },

  async listCompanies(opts: ListCompaniesOpts): Promise<Page<CompanyRecord>> {
    const limit = Math.min(opts.limit ?? 100, 200);
    const sortCol = opts.sort?.col ?? "name";
    const body: SearchBody = {
      properties: [...COMPANY_READ_PROPS],
      limit,
      after: opts.after,
      sorts: [{
        propertyName: COMPANY_SORT[sortCol] ?? "name",
        direction: (opts.sort?.dir ?? "asc") === "asc" ? "ASCENDING" : "DESCENDING",
      }],
    };
    if (opts.q?.trim()) body.query = opts.q.trim();
    const res = await search("companies", body);
    return {
      records: (res.results ?? []).map(fromHubspotCompany),
      total: res.total ?? 0,
      after: res.paging?.next?.after,
    };
  },

  async getCompany(id: string): Promise<CompanyRecord | null> {
    try {
      const obj = await hsFetch<HsObj>(
        `/crm/v3/objects/companies/${id}?properties=${COMPANY_READ_PROPS.join(",")}`,
        { cacheTtl: READ_TTL },
      );
      return fromHubspotCompany(obj);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  },

  async updateCompany(id: string, patch: CompanyWrite): Promise<CompanyRecord> {
    const props = toHubspotCompanyProps(patch);
    if (Object.keys(props).length > 0) {
      await hsFetch<HsObj>(`/crm/v3/objects/companies/${id}`, { method: "PATCH", body: { properties: props } });
      invalidateCache();
    }
    return (await this.getCompany(id))!;
  },

  async listCompanyContacts(companyId: string, limit = 100): Promise<ContactRecord[]> {
    const assoc = await hsFetch<{ results: { toObjectId: string | number }[] }>(
      `/crm/v4/objects/companies/${companyId}/associations/contacts?limit=${limit}`,
      { cacheTtl: READ_TTL },
    );
    const ids = (assoc.results ?? []).map((r) => String(r.toObjectId));
    if (ids.length === 0) return [];
    const read = await hsFetch<{ results: HsObj[] }>(
      `/crm/v3/objects/contacts/batch/read`,
      { method: "POST", body: { properties: [...CONTACT_READ_PROPS], inputs: ids.map((id) => ({ id })) }, cacheTtl: READ_TTL },
    );
    const names = await companyNames([companyId]);
    const company = { id: companyId, name: names.get(companyId) ?? null };
    return (read.results ?? []).map((o) => fromHubspotContact(o, company));
  },

  async listDeals(opts: ListDealsOpts): Promise<Page<DealRecord>> {
    const limit = Math.min(opts.limit ?? 100, 200);
    const sortCol = opts.sort?.col ?? "amount";
    const body: SearchBody = {
      properties: [...DEAL_READ_PROPS],
      limit,
      after: opts.after,
      sorts: [{
        propertyName: DEAL_SORT[sortCol] ?? "amount",
        direction: (opts.sort?.dir ?? "desc") === "asc" ? "ASCENDING" : "DESCENDING",
      }],
    };
    if (opts.q?.trim()) body.query = opts.q.trim();
    if (opts.stages?.length) body.filterGroups = [{ filters: [{ propertyName: "dealstage", operator: "IN", values: opts.stages }] }];
    const [res, labels] = await Promise.all([search("deals", body), dealLabels()]);
    const records = (res.results ?? []).map((d) =>
      fromHubspotDeal(
        d,
        labels.pipelines.get(d.properties.pipeline ?? "") ?? null,
        labels.stages.get(d.properties.dealstage ?? "") ?? null,
      ),
    );
    return { records, total: res.total ?? 0, after: res.paging?.next?.after };
  },
};

const DEAL_SORT: Record<string, string> = {
  name: "dealname", amount: "amount", close_date: "closedate",
  created_at: "createdate", last_contacted: "notes_last_contacted",
};

export interface DealPipeline { id: string; label: string; stages: { id: string; label: string }[] }

/** Deal pipelines + stages (cached 5m — pipelines rarely change). Used for the
 *  stage filter UI and for id→label resolution. */
export async function dealPipelines(): Promise<DealPipeline[]> {
  const res = await hsFetch<{ results: DealPipeline[] }>(`/crm/v3/pipelines/deals`, { cacheTtl: 300_000 });
  return res.results ?? [];
}

async function dealLabels(): Promise<{ pipelines: Map<string, string>; stages: Map<string, string> }> {
  const pipes = await dealPipelines();
  const pipelines = new Map<string, string>();
  const stages = new Map<string, string>();
  for (const p of pipes) {
    pipelines.set(p.id, p.label);
    for (const s of p.stages ?? []) stages.set(s.id, s.label);
  }
  return { pipelines, stages };
}

// ── capture helpers (used by the lead-capture pipeline) ─────────────────

/** Exact-match a contact by email (the natural key for lead dedupe). */
export async function findContactByEmail(email: string): Promise<ContactRecord | null> {
  const res = await search("contacts", {
    properties: [...CONTACT_READ_PROPS],
    limit: 1,
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.trim().toLowerCase() }] }],
  });
  const first = res.results?.[0];
  if (!first) return null;
  const [withCompany] = await attachCompanies([first]);
  return withCompany ?? null;
}

/** Exact-match a company by name (HubSpot string EQ is case-insensitive). */
export async function findCompanyByName(name: string): Promise<CompanyRecord | null> {
  const res = await search("companies", {
    properties: [...COMPANY_READ_PROPS],
    limit: 1,
    filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name.trim() }] }],
  });
  const first = res.results?.[0];
  return first ? fromHubspotCompany(first) : null;
}

export async function createCompany(input: { name: string; domain?: string | null; owner_id?: string | null }): Promise<CompanyRecord> {
  const properties: Record<string, string> = { name: input.name };
  if (input.domain) properties.domain = input.domain;
  if (input.owner_id) properties.hubspot_owner_id = input.owner_id;
  const created = await hsFetch<HsObj>(`/crm/v3/objects/companies`, { method: "POST", body: { properties } });
  invalidateCache();
  return fromHubspotCompany(created);
}

/** Log a Note engagement on a contact (the lead timeline entry). Best-effort:
 *  needs crm.objects.notes write scope — returns false (doesn't throw) if not
 *  granted, so lead capture still succeeds without the timeline note. */
export async function addContactNote(contactId: string, body: string): Promise<boolean> {
  try {
    const note = await hsFetch<HsObj>(`/crm/v3/objects/notes`, {
      method: "POST",
      body: { properties: { hs_timestamp: String(Date.now()), hs_note_body: body } },
    });
    await hsFetch(`/crm/v4/objects/notes/${note.id}/associations/default/contacts/${contactId}`, { method: "PUT" });
    invalidateCache();
    return true;
  } catch {
    return false;
  }
}

/** Set the (default) contact→company association. Additive — doesn't clear an
 *  existing different company. v4 "default" endpoint needs no typeId. */
async function setContactCompany(contactId: string, companyId: string): Promise<void> {
  await hsFetch(`/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`, { method: "PUT" });
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && "status" in e && (e as { status: number }).status === 404;
}

export { recordUrl };

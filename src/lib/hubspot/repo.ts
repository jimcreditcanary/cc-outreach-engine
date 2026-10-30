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
import { safeProps } from "./schema";
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
      properties: await safeProps("contacts", CONTACT_READ_PROPS),
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
        `/crm/v3/objects/contacts/${id}?properties=${(await safeProps("contacts", CONTACT_READ_PROPS)).join(",")}&associations=companies`,
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
      properties: await safeProps("companies", COMPANY_READ_PROPS),
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
        `/crm/v3/objects/companies/${id}?properties=${(await safeProps("companies", COMPANY_READ_PROPS)).join(",")}`,
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
      { method: "POST", body: { properties: await safeProps("contacts", CONTACT_READ_PROPS), inputs: ids.map((id) => ({ id })) }, cacheTtl: READ_TTL },
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

/** Open deals owned by a HubSpot owner (for the weekly deal-nurture run). */
export async function listOwnerOpenDeals(ownerId: string, limit = 50): Promise<DealRecord[]> {
  const labels = await dealLabels();
  const res = await search("deals", {
    properties: [...DEAL_READ_PROPS],
    limit: Math.min(limit, 200),
    filterGroups: [{ filters: [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
      { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
    ] }],
    sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
  });
  return (res.results ?? []).map((d) =>
    fromHubspotDeal(d, labels.pipelines.get(d.properties.pipeline ?? "") ?? null, labels.stages.get(d.properties.dealstage ?? "") ?? null),
  );
}

/** Deals closed-won since `sinceMs` (epoch ms), newest first — for the
 *  onboarding auto-create cron. Filters on hs_is_closed_won + closedate. */
export async function listRecentlyWonDeals(sinceMs: number, limit = 50): Promise<DealRecord[]> {
  const labels = await dealLabels();
  const res = await search("deals", {
    properties: [...DEAL_READ_PROPS],
    limit: Math.min(limit, 100),
    filterGroups: [{ filters: [
      { propertyName: "hs_is_closed_won", operator: "EQ", value: "true" },
      { propertyName: "closedate", operator: "GTE", value: String(Math.floor(sinceMs)) },
    ] }],
    sorts: [{ propertyName: "closedate", direction: "DESCENDING" }],
  });
  return (res.results ?? []).map((d) =>
    fromHubspotDeal(d, labels.pipelines.get(d.properties.pipeline ?? "") ?? null, labels.stages.get(d.properties.dealstage ?? "") ?? null),
  );
}

/** Best-effort: reflect an onboarding case's status onto the deal's
 *  `onboarding_status` property, so it's visible in HubSpot. No-ops (returns
 *  false) unless the property exists AND the token has deals-write scope — run
 *  scripts/onboarding-setup-props.ts and add crm.objects.deals.write to enable. */
export async function syncDealOnboardingStatus(dealId: string, status: string, caseId?: string): Promise<boolean> {
  try {
    const properties: Record<string, string> = { onboarding_status: status };
    if (caseId) properties.onboarding_case_id = caseId;
    await hsFetch(`/crm/v3/objects/deals/${dealId}`, { method: "PATCH", body: { properties } });
    invalidateCache();
    return true;
  } catch {
    return false;
  }
}

// Deal↔contact association-label (role) support (onboarding stakeholders). The
// label TYPES are created once by scripts/onboarding-setup-associations.ts;
// here we resolve a role's label to its typeId and apply it. All best-effort —
// no-ops until the labels exist + the token has crm.associations write scope.
let _roleLabelCache: { at: number; map: Map<string, number> } | null = null;

async function dealContactRoleLabels(): Promise<Map<string, number>> {
  if (_roleLabelCache && Date.now() - _roleLabelCache.at < 300_000) return _roleLabelCache.map;
  const res = await hsFetch<{ results: { category: string; typeId: number; label: string | null }[] }>(
    `/crm/v4/associations/deals/contacts/labels`, { cacheTtl: 300_000 },
  );
  const map = new Map<string, number>();
  for (const r of res.results ?? []) {
    if (r.category === "USER_DEFINED" && r.label) map.set(r.label.toLowerCase(), r.typeId);
  }
  _roleLabelCache = { at: Date.now(), map };
  return map;
}

/** Apply a labeled deal↔contact association for a stakeholder role. Best-effort:
 *  false if the label isn't set up or the write scope is missing. */
export async function associateDealContactRole(dealId: string, contactId: string, roleLabel: string): Promise<boolean> {
  try {
    const typeId = (await dealContactRoleLabels()).get(roleLabel.toLowerCase());
    if (typeId == null) return false;
    await hsFetch(`/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
      method: "PUT",
      body: [{ associationCategory: "USER_DEFINED", associationTypeId: typeId }],
    });
    invalidateCache();
    return true;
  } catch {
    return false;
  }
}

/** The contact ids associated with a deal (primary first, best-effort). */
export async function dealContactIds(dealId: string): Promise<string[]> {
  try {
    const res = await hsFetch<{ results: { toObjectId: string | number }[] }>(
      `/crm/v4/objects/deals/${dealId}/associations/contacts?limit=20`, { cacheTtl: READ_TTL },
    );
    return (res.results ?? []).map((r) => String(r.toObjectId));
  } catch {
    return [];
  }
}

/** The primary company associated with a deal (for the onboarding case's
 *  hubspot_company_id). Best-effort: null on any failure. */
export async function dealCompanyId(dealId: string): Promise<string | null> {
  try {
    const res = await hsFetch<{ results: { toObjectId: string | number }[] }>(
      `/crm/v4/objects/deals/${dealId}/associations/companies?limit=1`, { cacheTtl: READ_TTL },
    );
    const first = (res.results ?? [])[0];
    return first ? String(first.toObjectId) : null;
  } catch {
    return null;
  }
}

/** A single deal by id, with pipeline/stage resolved to labels. For the Hot
 *  "work this deal" view. */
export async function getDeal(id: string): Promise<DealRecord | null> {
  try {
    const [obj, labels] = await Promise.all([
      hsFetch<HsObj>(`/crm/v3/objects/deals/${id}?properties=${[...DEAL_READ_PROPS].join(",")}`, { cacheTtl: READ_TTL }),
      dealLabels(),
    ]);
    return fromHubspotDeal(
      obj,
      labels.pipelines.get(obj.properties.pipeline ?? "") ?? null,
      labels.stages.get(obj.properties.dealstage ?? "") ?? null,
    );
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

const stripNoteHtml = (s: string): string =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Recent notes on a deal (newest first, HTML stripped) — the "latest update"
 *  context for the Hot work-this-deal flow. Best-effort: [] on any failure. */
export async function dealRecentNotes(dealId: string, limit = 5): Promise<{ ts: string | null; body: string }[]> {
  try {
    const assoc = await hsFetch<{ results: { toObjectId: string | number }[] }>(
      `/crm/v4/objects/deals/${dealId}/associations/notes?limit=${Math.min(limit * 2, 50)}`, { cacheTtl: READ_TTL },
    );
    const ids = (assoc.results ?? []).map((r) => String(r.toObjectId));
    if (ids.length === 0) return [];
    const read = await hsFetch<{ results: HsObj[] }>(
      `/crm/v3/objects/notes/batch/read`,
      { method: "POST", body: { properties: ["hs_note_body", "hs_timestamp"], inputs: ids.map((id) => ({ id })) }, cacheTtl: READ_TTL },
    );
    const notes = (read.results ?? [])
      .map((o) => ({
        ts: o.properties.hs_timestamp ? new Date(Number(o.properties.hs_timestamp)).toISOString() : null,
        body: stripNoteHtml(String(o.properties.hs_note_body ?? "")),
      }))
      .filter((n) => n.body);
    notes.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
    return notes.slice(0, limit);
  } catch {
    return [];
  }
}

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
    properties: await safeProps("contacts", CONTACT_READ_PROPS),
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
    properties: await safeProps("companies", COMPANY_READ_PROPS),
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
// HubSpot-defined association type ids, engagement → contact.
const ASSOC = { note: 202, email: 198, task: 204 } as const;
const toContact = (contactId: string, typeId: number) => [
  { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] },
];

export async function addContactNote(contactId: string, body: string): Promise<boolean> {
  try {
    await hsFetch<HsObj>(`/crm/v3/objects/notes`, {
      method: "POST",
      body: { properties: { hs_timestamp: String(Date.now()), hs_note_body: body }, associations: toContact(contactId, ASSOC.note) },
    });
    invalidateCache();
    return true;
  } catch {
    return false;
  }
}

/** Log an outbound email as a HubSpot Email activity on the contact (so sends
 *  made via Postmark show on the HubSpot timeline and feed "last contacted").
 *  Best-effort — returns false (doesn't throw) on failure. */
export async function logEmailActivity(contactId: string, email: { subject: string; text: string }): Promise<boolean> {
  try {
    await hsFetch<HsObj>(`/crm/v3/objects/emails`, {
      method: "POST",
      body: {
        properties: {
          hs_timestamp: String(Date.now()),
          hs_email_direction: "EMAIL",
          hs_email_status: "SENT",
          hs_email_subject: email.subject,
          hs_email_text: email.text,
        },
        associations: toContact(contactId, ASSOC.email),
      },
    });
    invalidateCache();
    return true;
  } catch {
    return false;
  }
}

export interface HsList { id: string; name: string; size: number | null }

/** Contact Lists/Segments defined in HubSpot (for the target-list picker). */
export async function listContactLists(limit = 150): Promise<HsList[]> {
  try {
    const res = await hsFetch<{ lists?: { listId: string; name: string; objectTypeId?: string; additionalProperties?: Record<string, string> }[] }>(
      `/crm/v3/lists/search`,
      { method: "POST", body: { count: limit, query: "", offset: 0, additionalProperties: ["hs_list_size"] }, cacheTtl: 60_000 },
    );
    return (res.lists ?? [])
      .filter((l) => !l.objectTypeId || l.objectTypeId === "0-1") // contact lists only
      .map((l) => ({ id: l.listId, name: l.name, size: Number(l.additionalProperties?.hs_list_size ?? "") || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Contact ids that are members of a HubSpot list. */
export async function listMembershipIds(listId: string, cap = 3000): Promise<string[]> {
  const out: string[] = [];
  let after: string | undefined;
  while (out.length < cap) {
    const res = await hsFetch<{ results?: { recordId: string }[]; paging?: { next?: { after?: string } } }>(
      `/crm/v3/lists/${listId}/memberships?limit=250${after ? `&after=${after}` : ""}`,
      { cacheTtl: 30_000 },
    );
    for (const r of res.results ?? []) out.push(String(r.recordId));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return out.slice(0, cap);
}

/** Resolve a HubSpot owner id from an email (for mapping a rep to their owner). */
export async function findOwnerIdByEmail(email: string): Promise<string | null> {
  try {
    const res = await hsFetch<{ results: { id: string }[] }>(`/crm/v3/owners?email=${encodeURIComponent(email)}&limit=1`, { cacheTtl: 300_000 });
    return res.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Create a follow-up Task on a contact (e.g. when they engage). Best-effort. */
export async function createContactTask(
  contactId: string,
  task: { subject: string; body?: string; ownerId?: string | null; priority?: "LOW" | "MEDIUM" | "HIGH" },
): Promise<boolean> {
  try {
    await hsFetch<HsObj>(`/crm/v3/objects/tasks`, {
      method: "POST",
      body: {
        properties: {
          hs_task_subject: task.subject,
          hs_task_body: task.body ?? "",
          hs_timestamp: String(Date.now()),
          hs_task_status: "NOT_STARTED",
          hs_task_priority: task.priority ?? "HIGH",
          hs_task_type: "TODO",
          ...(task.ownerId ? { hubspot_owner_id: task.ownerId } : {}),
        },
        associations: toContact(contactId, ASSOC.task),
      },
    });
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

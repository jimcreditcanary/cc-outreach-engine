// Read-only CrmRepository backed by the Supabase hs_mirror_* snapshot. Used as
// the failover source when HubSpot is unreachable (see ../crm/failover.ts). The
// mirror stores HubSpot's exact property bag, so we reuse the same mappers —
// records come out identical to the live path (stage/pipeline show as ids, since
// labels live in HubSpot). Writes are unsupported here and throw.

import { serviceClient } from "../db/client";
import { fromHubspotContact, fromHubspotCompany, fromHubspotDeal } from "../hubspot/mapping";
import type {
  CrmRepository, ContactRecord, CompanyRecord, DealRecord,
  ListContactsOpts, ListCompaniesOpts, ListDealsOpts, Page,
} from "../crm/types";

type DB = ReturnType<typeof serviceClient>;
interface MirrorRow { id: string; company_id?: string | null; properties: Record<string, string | null | undefined> }

const READONLY = () => { throw new Error("CRM is in read-only failover mode (HubSpot unavailable) — writes are paused."); };

// Opaque cursor = numeric offset (the UI treats `after` as opaque).
const offsetOf = (after?: string): number => { const n = Number(after); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const nextAfter = (offset: number, limit: number, total: number): string | undefined =>
  offset + limit < total ? String(offset + limit) : undefined;

const CONTACT_SORT: Record<string, string> = { full_name: "full_name", email: "email", job_title: "full_name", created_at: "mirrored_at" };
const COMPANY_SORT: Record<string, string> = { name: "name", industry: "name", created_at: "mirrored_at" };
const DEAL_SORT: Record<string, string> = { name: "dealname", amount: "amount", close_date: "mirrored_at", created_at: "mirrored_at", last_contacted: "mirrored_at" };

/** Resolve company id → name from the mirror, for a batch of contacts. */
async function companyNames(db: DB, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  const { data } = await db.from("hs_mirror_companies").select("id, name").in("id", uniq);
  for (const r of (data ?? []) as { id: string; name: string | null }[]) out.set(r.id, r.name);
  return out;
}

export const mirrorRepo: CrmRepository = {
  async listContacts(opts: ListContactsOpts): Promise<Page<ContactRecord>> {
    const db = serviceClient();
    const limit = Math.min(opts.limit ?? 100, 200);
    const offset = offsetOf(opts.after);
    const col = CONTACT_SORT[opts.sort?.col ?? "full_name"] ?? "full_name";
    let q = db.from("hs_mirror_contacts").select("id, company_id, properties", { count: "exact" });
    if (opts.q?.trim()) { const t = `%${opts.q.trim()}%`; q = q.or(`full_name.ilike.${t},email.ilike.${t}`); }
    if (opts.newOnly) q = q.eq("properties->>hs_lead_status", "NEW");
    q = q.order(col, { ascending: (opts.sort?.dir ?? "asc") === "asc", nullsFirst: false }).range(offset, offset + limit - 1);
    const { data, count } = await q;
    const rows = (data ?? []) as MirrorRow[];
    const names = await companyNames(db, rows.map((r) => r.company_id ?? "").filter(Boolean));
    const records = rows.map((r) => fromHubspotContact(
      { id: r.id, properties: r.properties },
      r.company_id ? { id: r.company_id, name: names.get(r.company_id) ?? null } : null,
    ));
    const total = count ?? records.length;
    return { records, total, after: nextAfter(offset, limit, total) };
  },

  async getContact(id: string): Promise<ContactRecord | null> {
    const db = serviceClient();
    const { data } = await db.from("hs_mirror_contacts").select("id, company_id, properties").eq("id", id).maybeSingle();
    const row = data as MirrorRow | null;
    if (!row) return null;
    let company: { id: string; name: string | null } | null = null;
    if (row.company_id) { const n = await companyNames(db, [row.company_id]); company = { id: row.company_id, name: n.get(row.company_id) ?? null }; }
    return fromHubspotContact({ id: row.id, properties: row.properties }, company);
  },

  async listCompanies(opts: ListCompaniesOpts): Promise<Page<CompanyRecord>> {
    const db = serviceClient();
    const limit = Math.min(opts.limit ?? 100, 200);
    const offset = offsetOf(opts.after);
    const col = COMPANY_SORT[opts.sort?.col ?? "name"] ?? "name";
    let q = db.from("hs_mirror_companies").select("id, properties", { count: "exact" });
    if (opts.q?.trim()) q = q.ilike("name", `%${opts.q.trim()}%`);
    q = q.order(col, { ascending: (opts.sort?.dir ?? "asc") === "asc", nullsFirst: false }).range(offset, offset + limit - 1);
    const { data, count } = await q;
    const records = ((data ?? []) as MirrorRow[]).map((r) => fromHubspotCompany({ id: r.id, properties: r.properties }));
    const total = count ?? records.length;
    return { records, total, after: nextAfter(offset, limit, total) };
  },

  async getCompany(id: string): Promise<CompanyRecord | null> {
    const db = serviceClient();
    const { data } = await db.from("hs_mirror_companies").select("id, properties").eq("id", id).maybeSingle();
    const row = data as MirrorRow | null;
    return row ? fromHubspotCompany({ id: row.id, properties: row.properties }) : null;
  },

  async listCompanyContacts(companyId: string, limit = 100): Promise<ContactRecord[]> {
    const db = serviceClient();
    const { data } = await db.from("hs_mirror_contacts").select("id, company_id, properties").eq("company_id", companyId).limit(limit);
    const rows = (data ?? []) as MirrorRow[];
    const names = await companyNames(db, [companyId]);
    const company = { id: companyId, name: names.get(companyId) ?? null };
    return rows.map((r) => fromHubspotContact({ id: r.id, properties: r.properties }, company));
  },

  async listDeals(opts: ListDealsOpts): Promise<Page<DealRecord>> {
    const db = serviceClient();
    const limit = Math.min(opts.limit ?? 100, 200);
    const offset = offsetOf(opts.after);
    const col = DEAL_SORT[opts.sort?.col ?? "amount"] ?? "amount";
    let q = db.from("hs_mirror_deals").select("id, properties", { count: "exact" });
    if (opts.q?.trim()) q = q.ilike("dealname", `%${opts.q.trim()}%`);
    if (opts.stages?.length) q = q.in("dealstage", opts.stages);
    q = q.order(col, { ascending: (opts.sort?.dir ?? "desc") === "asc", nullsFirst: false }).range(offset, offset + limit - 1);
    const { data, count } = await q;
    const records = ((data ?? []) as MirrorRow[]).map((r) => fromHubspotDeal({ id: r.id, properties: r.properties }, null, null));
    const total = count ?? records.length;
    return { records, total, after: nextAfter(offset, limit, total) };
  },

  // Writes can't reach HubSpot during an outage — surface a clear error.
  createContact: READONLY as unknown as CrmRepository["createContact"],
  updateContact: READONLY as unknown as CrmRepository["updateContact"],
  updateCompany: READONLY as unknown as CrmRepository["updateCompany"],
};

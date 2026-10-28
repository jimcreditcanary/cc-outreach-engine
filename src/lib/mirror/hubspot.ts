// Daily HubSpot → Supabase mirror. Pages the HubSpot *list* endpoint (unlike
// Search it has no 10k-result cap, so it handles the full 12k+ company base)
// and upserts every contact / company / deal into the hs_mirror_* tables as a
// disaster-recovery snapshot. Upsert-only: it never deletes, so a partial or
// failed run can't wipe the backup. Each object's run is logged to
// hs_mirror_runs. See migration 047.

import { hsFetch } from "../hubspot/client";
import { COMPANY_READ_PROPS, CONTACT_READ_PROPS, DEAL_READ_PROPS, fullName } from "../hubspot/mapping";
import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;
interface HsObj {
  id: string | number;
  properties: Record<string, string | null | undefined>;
  associations?: Record<string, { results?: { id: string | number; type?: string }[] }>;
}

// Snapshot a broad, business-meaningful superset: the props the app reads, plus
// common fields, so the mirror can also serve as a read fallback. (Not all ~260
// HubSpot props — mostly analytics noise — to keep the request + storage lean.)
const uniq = (xs: string[]) => [...new Set(xs)];
const COMPANY_PROPS = uniq([...COMPANY_READ_PROPS,
  "phone", "address", "city", "state", "zip", "country", "numberofemployees",
  "annualrevenue", "lifecyclestage", "hubspot_owner_id", "description",
  "linkedin_company_page", "founded_year", "type", "hs_object_id", "createdate", "hs_lastmodifieddate"]);
const CONTACT_PROPS = uniq([...CONTACT_READ_PROPS,
  "phone", "lifecyclestage", "hubspot_owner_id", "associatedcompanyid", "company",
  "website", "address", "city", "country", "hs_object_id"]);
const DEAL_PROPS = uniq([...DEAL_READ_PROPS, "hubspot_owner_id", "description", "hs_object_id"]);

const num = (v: string | null | undefined): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};
const firstAssoc = (o: HsObj, key: string): string | null =>
  o.associations?.[key]?.results?.[0]?.id != null ? String(o.associations[key]!.results![0]!.id) : null;

/** Page the list endpoint for every record of an object type. */
async function fetchAll(objectType: string, props: string[], associations?: string): Promise<HsObj[]> {
  const out: HsObj[] = [];
  const propQs = props.map((p) => `properties=${encodeURIComponent(p)}`).join("&");
  const assocQs = associations ? `&associations=${associations}` : "";
  let after: string | undefined;
  do {
    const url = `/crm/v3/objects/${objectType}?limit=100&archived=false&${propQs}${assocQs}${after ? `&after=${after}` : ""}`;
    const res = await hsFetch<{ results: HsObj[]; paging?: { next?: { after?: string } } }>(url);
    out.push(...(res.results ?? []));
    after = res.paging?.next?.after;
  } while (after);
  return out;
}

async function upsertChunked<T extends { id: string }>(db: DB, table: string, rows: T[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
    done += chunk.length;
  }
  return done;
}

interface ObjectResult { object_type: string; fetched: number; upserted: number; ok: boolean; error?: string }

async function mirrorObject(
  db: DB,
  objectType: "companies" | "contacts" | "deals",
  map: (o: HsObj) => Record<string, unknown> & { id: string },
  table: string,
  props: string[],
  associations?: string,
): Promise<ObjectResult> {
  const started = new Date().toISOString();
  try {
    const objs = await fetchAll(objectType, props, associations);
    const rows = objs.map(map);
    const upserted = await upsertChunked(db, table, rows);
    await db.from("hs_mirror_runs").insert({ object_type: objectType, fetched: objs.length, upserted, ok: true, started_at: started, finished_at: new Date().toISOString() });
    return { object_type: objectType, fetched: objs.length, upserted, ok: true };
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    await db.from("hs_mirror_runs").insert({ object_type: objectType, ok: false, error, started_at: started, finished_at: new Date().toISOString() });
    return { object_type: objectType, fetched: 0, upserted: 0, ok: false, error };
  }
}

export interface MirrorResult { ok: boolean; objects: ObjectResult[] }

export async function runHubspotMirror(db: DB, opts: { only?: ("companies" | "contacts" | "deals")[] } = {}): Promise<MirrorResult> {
  const now = () => new Date().toISOString();
  const want = (t: "companies" | "contacts" | "deals") => !opts.only || opts.only.includes(t);
  const objects: ObjectResult[] = [];

  if (want("companies")) {
    objects.push(await mirrorObject(db, "companies", (o) => ({
      id: String(o.id), name: o.properties.name ?? null, domain: o.properties.domain ?? null,
      properties: o.properties, associations: o.associations ?? null, mirrored_at: now(),
    }), "hs_mirror_companies", COMPANY_PROPS));
  }
  if (want("contacts")) {
    objects.push(await mirrorObject(db, "contacts", (o) => ({
      id: String(o.id),
      email: o.properties.email ?? null,
      full_name: fullName(o.properties.firstname, o.properties.lastname, o.properties.email ?? null) || null,
      company_id: o.properties.associatedcompanyid ?? firstAssoc(o, "companies"),
      properties: o.properties, associations: o.associations ?? null, mirrored_at: now(),
    }), "hs_mirror_contacts", CONTACT_PROPS, "companies"));
  }
  if (want("deals")) {
    objects.push(await mirrorObject(db, "deals", (o) => ({
      id: String(o.id), dealname: o.properties.dealname ?? null, amount: num(o.properties.amount), dealstage: o.properties.dealstage ?? null,
      properties: o.properties, associations: o.associations ?? null, mirrored_at: now(),
    }), "hs_mirror_deals", DEAL_PROPS, "companies,contacts"));
  }

  return { ok: objects.every((o) => o.ok), objects };
}

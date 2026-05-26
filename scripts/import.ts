// CRM importer CLI.
//
//   npm run import -- organisations ./organisations.csv
//   npm run import -- contacts      ./contacts.xlsx
//   npm run import -- deals         ./deals.xlsx
//
// Tolerant of column-name drift (see mappers.ts). Upserts by Pipedrive id
// when the export carries one, else by a natural key (org name / email /
// org+title). After a deals import it re-derives every org's tier (§5).

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { parseTabular } from "../src/lib/import/parse";
import { mapOrg, mapContact, mapDeal, mapNote } from "../src/lib/import/mappers";
import { deriveTier, type DealTierInput } from "../src/lib/tier/derive";

config({ path: ".env.local" });

type Kind = "organisations" | "contacts" | "deals" | "notes";

async function main() {
  const [kind, file] = process.argv.slice(2) as [Kind, string];
  if (!kind || !file) {
    console.error("usage: import <organisations|contacts|deals|notes> <file.csv|.xlsx>");
    process.exit(1);
  }

  const rows = parseTabular(readFileSync(file), file);
  const db = serviceClient();
  console.log(`Parsed ${rows.length} rows from ${file}`);

  if (kind === "organisations") await importOrgs(db, rows);
  else if (kind === "contacts") await importContacts(db, rows);
  else if (kind === "deals") {
    await importDeals(db, rows);
    await rederiveAllTiers(db);
  } else if (kind === "notes") await importNotes(db, rows);
  else {
    console.error(`unknown kind: ${kind}`);
    process.exit(1);
  }

  console.log("Done.");
}

type DB = ReturnType<typeof serviceClient>;

interface OrgCaches {
  byId: Map<number, string>;
  byName: Map<string, string>;
}
const newOrgCaches = (): OrgCaches => ({ byId: new Map(), byName: new Map() });

/**
 * Resolve an organisation id, preferring the Pipedrive org id (stable)
 * over the name (drifts). Orgs present in the org export are found; orgs
 * referenced only by people/notes (investors, partners not in the buyer
 * list) are created as stubs keyed by their Pipedrive id so they dedupe
 * cleanly. Returns null when neither id nor name is given.
 */
async function resolveOrgId(
  db: DB,
  opts: { pipedriveId?: number; name?: string },
  caches: OrgCaches,
): Promise<string | null> {
  const { pipedriveId, name } = opts;

  if (pipedriveId !== undefined) {
    const c = caches.byId.get(pipedriveId);
    if (c) return c;
    const { data } = await db
      .from("organisations")
      .select("id")
      .eq("pipedrive_org_id", pipedriveId)
      .maybeSingle();
    if (data?.id) {
      caches.byId.set(pipedriveId, data.id);
      return data.id;
    }
  }
  if (name) {
    const key = name.toLowerCase();
    const c = caches.byName.get(key);
    if (c) return c;
    const { data } = await db.from("organisations").select("id").ilike("name", name).maybeSingle();
    if (data?.id) {
      caches.byName.set(key, data.id);
      return data.id;
    }
  }
  if (pipedriveId === undefined && !name) return null;

  // Not found anywhere — create a stub (an external org not in the export).
  const insert: Record<string, unknown> = { name: name ?? `(unknown org ${pipedriveId})` };
  if (pipedriveId !== undefined) insert.pipedrive_org_id = pipedriveId;
  const { data, error } = await db.from("organisations").insert(insert).select("id").single();
  if (error) throw error;
  if (pipedriveId !== undefined) caches.byId.set(pipedriveId, data.id);
  if (name) caches.byName.set(name.toLowerCase(), data.id);
  return data.id;
}

/** Contact id by Pipedrive person id (cached). */
async function findContactByPersonId(
  db: DB,
  personId: number,
  cache: Map<number, string>,
): Promise<string | null> {
  const c = cache.get(personId);
  if (c) return c;
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("pipedrive_person_id", personId)
    .maybeSingle();
  if (data?.id) {
    cache.set(personId, data.id);
    return data.id;
  }
  return null;
}

/** Deal id by Pipedrive deal id (cached). */
async function findDealByPipedriveId(
  db: DB,
  dealId: number,
  cache: Map<number, string>,
): Promise<string | null> {
  const c = cache.get(dealId);
  if (c) return c;
  const { data } = await db.from("deals").select("id").eq("pipedrive_deal_id", dealId).maybeSingle();
  if (data?.id) {
    cache.set(dealId, data.id);
    return data.id;
  }
  return null;
}

async function importOrgs(db: DB, rows: unknown[]) {
  let n = 0;
  for (const row of rows) {
    const org = mapOrg(row as Record<string, unknown>);
    if (!org) continue;
    // The curated org export IS the ICP universe (per Jim) — every org in
    // it is an ICP, regardless of the source ICP Yes/No column (preserved
    // in raw). External orgs (auto-created stubs) stay non-ICP.
    const record = { ...org, icp: true, raw: row as Record<string, unknown> };
    if (org.pipedrive_org_id) {
      const { error } = await db
        .from("organisations")
        .upsert(record, { onConflict: "pipedrive_org_id" });
      if (error) throw error;
    } else {
      const { data: existing } = await db
        .from("organisations")
        .select("id")
        .ilike("name", org.name)
        .maybeSingle();
      const { error } = existing
        ? await db.from("organisations").update(record).eq("id", existing.id)
        : await db.from("organisations").insert(record);
      if (error) throw error;
    }
    n++;
  }
  console.log(`Upserted ${n} organisations`);
}

async function importContacts(db: DB, rows: unknown[]) {
  const orgCaches = newOrgCaches();
  let n = 0;
  for (const row of rows) {
    const c = mapContact(row as Record<string, unknown>);
    if (!c) continue;
    const organisation_id = await resolveOrgId(
      db,
      { pipedriveId: c.organisation_pipedrive_id, name: c.organisation_name },
      orgCaches,
    );
    const { organisation_name: _n, organisation_pipedrive_id: _pid, ...rest } = c;
    const record = { ...rest, organisation_id, raw: row as Record<string, unknown> };

    if (c.pipedrive_person_id) {
      const { error } = await db
        .from("contacts")
        .upsert(record, { onConflict: "pipedrive_person_id" });
      if (error) throw error;
    } else if (c.email) {
      const { data: existing } = await db
        .from("contacts")
        .select("id")
        .ilike("email", c.email)
        .maybeSingle();
      const { error } = existing
        ? await db.from("contacts").update(record).eq("id", existing.id)
        : await db.from("contacts").insert(record);
      if (error) throw error;
    } else {
      const { error } = await db.from("contacts").insert(record);
      if (error) throw error;
    }
    n++;
  }
  console.log(`Upserted ${n} contacts`);
}

async function importDeals(db: DB, rows: unknown[]) {
  const orgCaches = newOrgCaches();
  const contactCache = new Map<number, string>();
  let n = 0;
  for (const row of rows) {
    const d = mapDeal(row as Record<string, unknown>);
    if (!d) continue;
    const organisation_id = await resolveOrgId(
      db,
      { pipedriveId: d.organisation_pipedrive_id, name: d.organisation_name },
      orgCaches,
    );
    const primary_contact_id = d.primary_contact_pipedrive_id
      ? await findContactByPersonId(db, d.primary_contact_pipedrive_id, contactCache)
      : null;
    const {
      organisation_name: _n,
      organisation_pipedrive_id: _pid,
      primary_contact_pipedrive_id: _cpid,
      ...rest
    } = d;
    const record = { ...rest, organisation_id, primary_contact_id, raw: row as Record<string, unknown> };

    if (d.pipedrive_deal_id) {
      const { error } = await db
        .from("deals")
        .upsert(record, { onConflict: "pipedrive_deal_id" });
      if (error) throw error;
    } else if (organisation_id && d.title) {
      const { data: existing } = await db
        .from("deals")
        .select("id")
        .eq("organisation_id", organisation_id)
        .ilike("title", d.title)
        .maybeSingle();
      const { error } = existing
        ? await db.from("deals").update(record).eq("id", existing.id)
        : await db.from("deals").insert(record);
      if (error) throw error;
    } else {
      const { error } = await db.from("deals").insert(record);
      if (error) throw error;
    }
    n++;
  }
  console.log(`Upserted ${n} deals`);
}

/** Best-effort deal lookup by org + title (null when not found). */
async function findDealId(db: DB, organisation_id: string | null, title?: string): Promise<string | null> {
  if (!organisation_id || !title) return null;
  const { data } = await db
    .from("deals")
    .select("id")
    .eq("organisation_id", organisation_id)
    .ilike("title", title)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Best-effort contact lookup by email, else by name within the org. */
async function findContactId(
  db: DB,
  organisation_id: string | null,
  email?: string,
  name?: string,
): Promise<string | null> {
  if (email) {
    const { data } = await db.from("contacts").select("id").ilike("email", email).maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (organisation_id && name) {
    const { data } = await db
      .from("contacts")
      .select("id")
      .eq("organisation_id", organisation_id)
      .ilike("full_name", name)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

async function importNotes(db: DB, rows: unknown[]) {
  const orgCaches = newOrgCaches();
  const contactCache = new Map<number, string>();
  const dealCache = new Map<number, string>();
  let n = 0;
  for (const row of rows) {
    const note = mapNote(row as Record<string, unknown>);
    if (!note) continue;
    const organisation_id = await resolveOrgId(
      db,
      { pipedriveId: note.organisation_pipedrive_id, name: note.organisation_name },
      orgCaches,
    );
    const contact_id = note.contact_pipedrive_id
      ? await findContactByPersonId(db, note.contact_pipedrive_id, contactCache)
      : await findContactId(db, organisation_id, note.contact_email, note.contact_name);
    const deal_id = note.deal_pipedrive_id
      ? await findDealByPipedriveId(db, note.deal_pipedrive_id, dealCache)
      : await findDealId(db, organisation_id, note.deal_title);

    const record = {
      pipedrive_note_id: note.pipedrive_note_id ?? null,
      organisation_id,
      deal_id,
      contact_id,
      content: note.content,
      author: note.author ?? null,
      noted_at: note.noted_at ?? null,
      raw: row as Record<string, unknown>,
    };

    if (note.pipedrive_note_id) {
      const { error } = await db.from("notes").upsert(record, { onConflict: "pipedrive_note_id" });
      if (error) throw error;
    } else {
      const { error } = await db.from("notes").insert(record);
      if (error) throw error;
    }
    n++;
  }
  console.log(`Upserted ${n} notes`);
}

/** Recompute and cache every org's tier from its deals (§5). */
async function rederiveAllTiers(db: DB) {
  const { data: orgs, error } = await db.from("organisations").select("id");
  if (error) throw error;
  let n = 0;
  for (const org of orgs ?? []) {
    const { data: deals } = await db
      .from("deals")
      .select("status, proposal_exists")
      .eq("organisation_id", org.id);
    const tier = deriveTier((deals ?? []) as DealTierInput[]);
    const { error: upErr } = await db
      .from("organisations")
      .update({ tier })
      .eq("id", org.id);
    if (upErr) throw upErr;
    n++;
  }
  console.log(`Re-derived tiers for ${n} organisations`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

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
import { mapOrg, mapContact, mapDeal } from "../src/lib/import/mappers";
import { deriveTier, type DealTierInput } from "../src/lib/tier/derive";

config({ path: ".env.local" });

type Kind = "organisations" | "contacts" | "deals";

async function main() {
  const [kind, file] = process.argv.slice(2) as [Kind, string];
  if (!kind || !file) {
    console.error("usage: import <organisations|contacts|deals> <file.csv|.xlsx>");
    process.exit(1);
  }

  const rows = parseTabular(readFileSync(file));
  const db = serviceClient();
  console.log(`Parsed ${rows.length} rows from ${file}`);

  if (kind === "organisations") await importOrgs(db, rows);
  else if (kind === "contacts") await importContacts(db, rows);
  else if (kind === "deals") {
    await importDeals(db, rows);
    await rederiveAllTiers(db);
  } else {
    console.error(`unknown kind: ${kind}`);
    process.exit(1);
  }

  console.log("Done.");
}

type DB = ReturnType<typeof serviceClient>;

/** Resolve (and cache) an organisation id by name, creating a stub if new. */
async function resolveOrgId(db: DB, name: string, cache: Map<string, string>): Promise<string> {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const { data: existing } = await db
    .from("organisations")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await db
      .from("organisations")
      .insert({ name })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  }
  cache.set(key, id);
  return id;
}

async function importOrgs(db: DB, rows: unknown[]) {
  let n = 0;
  for (const row of rows) {
    const org = mapOrg(row as Record<string, unknown>);
    if (!org) continue;
    if (org.pipedrive_org_id) {
      const { error } = await db
        .from("organisations")
        .upsert(org, { onConflict: "pipedrive_org_id" });
      if (error) throw error;
    } else {
      const { data: existing } = await db
        .from("organisations")
        .select("id")
        .ilike("name", org.name)
        .maybeSingle();
      const { error } = existing
        ? await db.from("organisations").update(org).eq("id", existing.id)
        : await db.from("organisations").insert(org);
      if (error) throw error;
    }
    n++;
  }
  console.log(`Upserted ${n} organisations`);
}

async function importContacts(db: DB, rows: unknown[]) {
  const orgCache = new Map<string, string>();
  let n = 0;
  for (const row of rows) {
    const c = mapContact(row as Record<string, unknown>);
    if (!c) continue;
    const organisation_id = c.organisation_name
      ? await resolveOrgId(db, c.organisation_name, orgCache)
      : null;
    const { organisation_name: _drop, ...rest } = c;
    const record = { ...rest, organisation_id };

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
  const orgCache = new Map<string, string>();
  let n = 0;
  for (const row of rows) {
    const d = mapDeal(row as Record<string, unknown>);
    if (!d) continue;
    const organisation_id = d.organisation_name
      ? await resolveOrgId(db, d.organisation_name, orgCache)
      : null;
    const { organisation_name: _drop, ...rest } = d;
    const record = { ...rest, organisation_id };

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

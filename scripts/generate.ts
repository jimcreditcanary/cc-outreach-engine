// Generate drafts into the approval queue (build brief step 4 / §14).
//
//   npm run generate -- [limit]      (default 5)
//
// Selects due contacts (have email, non-partner org, sector set, tier 2/3,
// not suppressed, no existing send), gathers org notes + sector-matched
// content assets, generates a draft in Jim's voice, runs the anonymisation
// gate, and inserts a `sends` row at status='queued' for Jim to approve.
// Nothing is sent — that's step 5.

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { generateDraft, type AssetOption, type ContactCtx } from "../src/lib/generate/draft";
import { isDue, applyPerCompanyCap, DEFAULT_COOLDOWN_DAYS } from "../src/lib/cadence/cadence";
import { matchSignals, type SignalInput } from "../src/lib/signals/triggers";
import type { Sector } from "../src/lib/import/mappers";

config({ path: ".env.local", override: true });

type DB = ReturnType<typeof serviceClient>;
type AssetRow = AssetOption & { id: string };

async function loadAssetsForSector(db: DB, sector: string, cache: Map<string, AssetRow[]>): Promise<AssetRow[]> {
  const hit = cache.get(sector);
  if (hit) return hit;
  const { data } = await db
    .from("content_assets")
    .select("id, url, title, description, type, tags_problem")
    .contains("tags_sector", [sector])
    .limit(15);
  const assets = (data ?? []) as AssetRow[];
  cache.set(sector, assets);
  return assets;
}

async function main() {
  const limit = Number(process.argv[2] ?? 5);
  const db = serviceClient();

  // Suppression list + already-queued/sent contacts (dedupe).
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String(s.email).toLowerCase()));
  // Only PENDING sends block (don't double-queue); a 'sent' contact can be
  // re-touched once cooldown passes — that's the cadence engine's job.
  const { data: pending } = await db.from("sends").select("contact_id").in("status", ["queued", "approved"]);
  const inPipeline = new Set((pending ?? []).map((s) => s.contact_id as string));

  const cooldownDays = Number(process.env.CADENCE_COOLDOWN_DAYS ?? DEFAULT_COOLDOWN_DAYS);
  const maxPerCompany = Number(process.env.CADENCE_MAX_PER_COMPANY ?? 1);
  const now = new Date();

  // Candidate contacts with their org embedded.
  const { data: contacts, error } = await db
    .from("contacts")
    .select("id, full_name, email, job_title, label, last_touched_at, snooze_until, organisation:organisations(id, name, sector, tier, is_partner)")
    .not("email", "is", null)
    .limit(3000);
  if (error) throw error;

  const due = (contacts ?? []).filter((c) => {
    const org = c.organisation as unknown as
      | { id: string; name: string; sector: string | null; tier: number | null; is_partner: boolean }
      | null;
    if (!org || org.is_partner || !org.sector || (org.tier !== 2 && org.tier !== 3)) return false;
    if (inPipeline.has(c.id as string)) return false;
    if (c.email && suppressed.has(String(c.email).toLowerCase())) return false;
    // Cadence: not snoozed, outside the cooldown window.
    return isDue(
      { last_touched_at: c.last_touched_at as string | null, snooze_until: c.snooze_until as string | null },
      now,
      cooldownDays,
    );
  });

  // Prospects first, then per-company cap so one org isn't hit from many angles.
  due.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));
  const capped = applyPerCompanyCap(
    due.map((c) => ({ ...c, organisation_id: (c.organisation as unknown as { id: string }).id })),
    maxPerCompany,
  );
  const batch = capped.slice(0, limit);
  console.log(`${due.length} due contacts; generating ${batch.length}.`);

  // Recent regulatory/market signals (last 45 days) → matched per sector.
  const since = new Date(now.getTime() - 45 * 86_400_000).toISOString();
  const { data: press } = await db
    .from("events")
    .select("payload, source, ts")
    .eq("type", "press")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(120);
  const recentSignals: SignalInput[] = (press ?? []).map((p) => {
    const pl = p.payload as { title?: string; summary?: string; link?: string };
    return { title: pl.title ?? "", summary: pl.summary ?? null, link: pl.link ?? "", source: String(p.source ?? "") };
  });

  const assetCache = new Map<string, AssetRow[]>();
  let queued = 0;
  let flagged = 0;

  for (const c of batch) {
    const org = c.organisation as unknown as { id: string; name: string; sector: string; tier: number | null };
    const assets = await loadAssetsForSector(db, org.sector, assetCache);

    const { data: notes } = await db
      .from("notes")
      .select("content")
      .eq("organisation_id", org.id)
      .order("noted_at", { ascending: false })
      .limit(3);

    const ctx: ContactCtx = {
      first_name: String(c.full_name ?? "there").trim().split(/\s+/)[0] || "there",
      full_name: String(c.full_name ?? ""),
      job_title: c.job_title as string | null,
      org_name: org.name,
      sector: org.sector,
      tier: org.tier,
      label: c.label as string | null,
      notes: (notes ?? []).map((n) => String(n.content)).filter(Boolean),
    };

    const signals = matchSignals(recentSignals, org.sector as Sector);
    const draft = await generateDraft(ctx, assets, signals);
    if (!draft) {
      console.warn(`  FLAGGED (anonymisation) — ${ctx.full_name} @ ${org.name}`);
      flagged++;
      continue;
    }

    const asset_id = assets.find((a) => a.url === draft.asset_url)?.id ?? null;
    const { error: insErr } = await db.from("sends").insert({
      contact_id: c.id,
      angle: draft.angle,
      asset_id,
      subject: draft.subject,
      body_html: draft.body_html,
      body_text: draft.body_text,
      status: "queued",
    });
    if (insErr) throw insErr;

    queued++;
    console.log(`  [${queued}] ${ctx.full_name} @ ${org.name} (${org.sector}) — "${draft.subject}" [${draft.angle}]`);
  }

  console.log(`Queued ${queued} drafts; ${flagged} flagged. Review with: npm run review`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

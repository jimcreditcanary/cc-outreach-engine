// Attendee CSV/xlsx → conference_attendances. For each row we resolve a
// contact via this waterfall:
//
//   1. EMAIL exact (case-insensitive)   → matched_via = 'email'
//   2. NAME + COMPANY exact (normalised) → matched_via = 'name_company'
//   3. Has at least one of {email, name} → create the contact (+ company)
//                                          → matched_via = 'created'
//   4. Only job_title + company          → placeholder contact with
//                                          needs_research = true
//                                          → matched_via = 'needs_research'
//
// Pure-ish: takes a DB client + the parsed rows, returns a per-row outcome.
// The /events/[id] upload action persists `attendances` from the result.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AttendeeRow {
  email?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  company?: string | null;
}

export interface MatchOutcome {
  contact_id: string;
  matched_via: "email" | "name_company" | "created" | "needs_research";
  full_name: string | null;
  email: string | null;
  company: string | null;
}

export interface MatchSummary {
  outcomes: MatchOutcome[];
  counts: Record<MatchOutcome["matched_via"], number>;
  skipped: number;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
    .replace(/\s+(ltd|limited|plc|inc|llc|gmbh|sa|nv|ag)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolve or create a single organisation by name. Returns null when the
 *  caller passed an empty company. Best-effort: ignores RLS / unique-key
 *  races by falling back to a re-lookup. */
async function resolveOrg(db: SupabaseClient, name: string | null, ownerId: string | null): Promise<string | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const { data: existing } = await db.from("organisations").select("id").ilike("name", trimmed).maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await db
    .from("organisations")
    .insert({ name: trimmed, icp: true, owner_id: ownerId })
    .select("id")
    .single();
  if (created) return created.id as string;
  if (error) {
    // Race: someone else created the same org between our check + insert.
    const { data: retry } = await db.from("organisations").select("id").ilike("name", trimmed).maybeSingle();
    if (retry) return retry.id as string;
    throw error;
  }
  return null;
}

export async function matchAttendees(
  db: SupabaseClient,
  rows: AttendeeRow[],
  ownerId: string | null,
): Promise<MatchSummary> {
  // Pre-load every contact once so the per-row waterfall doesn't N+1.
  const { data: contactRows } = await db
    .from("contacts")
    .select("id, full_name, email, organisation:organisations(id, name)")
    .limit(50000);

  type Loaded = { id: string; full_name: string | null; email: string | null; org_id: string | null; org_name: string | null };
  const all: Loaded[] = (contactRows ?? []).map((c) => {
    const o = c.organisation as unknown as { id: string | null; name: string | null } | null;
    return {
      id: c.id as string,
      full_name: c.full_name as string | null,
      email: c.email as string | null,
      org_id: o?.id ?? null,
      org_name: o?.name ?? null,
    };
  });
  const byEmail = new Map<string, Loaded>();
  const byNameCompany = new Map<string, Loaded>();
  for (const c of all) {
    if (c.email) byEmail.set(c.email.toLowerCase(), c);
    if (c.full_name && c.org_name) byNameCompany.set(`${norm(c.full_name)}|${norm(c.org_name)}`, c);
  }

  const outcomes: MatchOutcome[] = [];
  const counts = { email: 0, name_company: 0, created: 0, needs_research: 0 } as MatchSummary["counts"];
  let skipped = 0;

  for (const raw of rows) {
    const email = (raw.email ?? "").trim().toLowerCase();
    const fullName = (raw.full_name ?? "").trim();
    const jobTitle = (raw.job_title ?? "").trim();
    const company = (raw.company ?? "").trim();

    // No usable identity at all → skip (don't pollute the DB with empty rows).
    if (!email && !fullName && !jobTitle) { skipped++; continue; }

    // 1) Exact email match
    if (email && byEmail.has(email)) {
      const hit = byEmail.get(email)!;
      outcomes.push({ contact_id: hit.id, matched_via: "email", full_name: hit.full_name, email: hit.email, company: hit.org_name });
      counts.email++;
      continue;
    }

    // 2) Name + company normalised match
    if (fullName && company) {
      const key = `${norm(fullName)}|${norm(company)}`;
      if (byNameCompany.has(key)) {
        const hit = byNameCompany.get(key)!;
        outcomes.push({ contact_id: hit.id, matched_via: "name_company", full_name: hit.full_name, email: hit.email, company: hit.org_name });
        counts.name_company++;
        continue;
      }
    }

    // 3) Create — we have at least a name OR an email.
    const orgId = await resolveOrg(db, company || null, ownerId);
    if (fullName || email) {
      const { data: created, error } = await db
        .from("contacts")
        .insert({
          full_name: fullName || (email.split("@")[0] || "(unnamed)"),
          email: email || null,
          job_title: jobTitle || null,
          organisation_id: orgId,
          owner_id: ownerId,
          email_status: "unverified",
        })
        .select("id, full_name, email")
        .single();
      if (error) throw error;
      outcomes.push({
        contact_id: created.id as string,
        matched_via: "created",
        full_name: created.full_name as string | null,
        email: created.email as string | null,
        company,
      });
      counts.created++;
      // Add to in-memory caches in case the next row matches the one we just made.
      const loaded: Loaded = { id: created.id as string, full_name: created.full_name as string | null, email: created.email as string | null, org_id: orgId, org_name: company || null };
      if (loaded.email) byEmail.set(loaded.email.toLowerCase(), loaded);
      if (loaded.full_name && loaded.org_name) byNameCompany.set(`${norm(loaded.full_name)}|${norm(loaded.org_name)}`, loaded);
      continue;
    }

    // 4) Job title + company only → placeholder needing research.
    const placeholder = `(needs identifying — ${jobTitle || "attendee"})`;
    const { data: ph, error } = await db
      .from("contacts")
      .insert({
        full_name: placeholder,
        job_title: jobTitle || null,
        organisation_id: orgId,
        owner_id: ownerId,
        email_status: "unverified",
        needs_research: true,
      })
      .select("id, full_name, email")
      .single();
    if (error) throw error;
    outcomes.push({
      contact_id: ph.id as string,
      matched_via: "needs_research",
      full_name: ph.full_name as string | null,
      email: null,
      company,
    });
    counts.needs_research++;
  }

  return { outcomes, counts, skipped };
}

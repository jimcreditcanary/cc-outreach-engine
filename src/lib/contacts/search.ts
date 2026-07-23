// Shared search filter for the Contacts list + CSV export, so both match the
// same rows. The search box matches a contact's name, email, OR company name.
//
// Company matching needs a two-step: PostgREST can't put an `.or()` condition
// on an embedded table (organisations) alongside base-table columns, so we
// first resolve company names to ids, then fold `organisation_id.in.(…)` into
// the same OR clause. Returns null when the term is empty (no filtering).

import type { SupabaseClient } from "@supabase/supabase-js";

export async function contactSearchOr(
  db: SupabaseClient,
  q: string | undefined,
): Promise<string | null> {
  const term = q?.trim();
  if (!term) return null;

  // Strip characters that would break the PostgREST `.or()` grammar
  // (comma separates conditions, parens group them) before embedding.
  const safe = term.replace(/[,()]/g, " ").trim();
  const parts = [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`];

  // `.ilike()` here is a builder arg (safely escaped), so use the raw term.
  const { data: orgs } = await db
    .from("organisations")
    .select("id")
    .ilike("name", `%${term}%`)
    .limit(500);
  const ids = ((orgs ?? []) as { id: string }[]).map((o) => o.id);
  if (ids.length) parts.push(`organisation_id.in.(${ids.join(",")})`);

  return parts.join(",");
}

// Load a salesperson's drafting voice (DraftConfig) from user_settings.draft_config,
// merged over the app defaults so blank/missing fields fall back to Jim's voice.
// Graceful if migration 040 hasn't run (column missing) → defaults.

import type { serviceClient } from "../db/client";
import { DEFAULT_DRAFT_CONFIG, type DraftConfig } from "./draft";

type DB = ReturnType<typeof serviceClient>;

function pruneBlank(cfg: Partial<DraftConfig>): Partial<DraftConfig> {
  return Object.fromEntries(
    Object.entries(cfg).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  ) as Partial<DraftConfig>;
}

export async function loadDraftConfig(db: DB, userId: string | null | undefined): Promise<DraftConfig> {
  if (!userId) return DEFAULT_DRAFT_CONFIG;
  try {
    const { data } = await db.from("user_settings").select("draft_config").eq("user_id", userId).maybeSingle();
    const stored = (data?.draft_config ?? null) as Partial<DraftConfig> | null;
    return stored ? { ...DEFAULT_DRAFT_CONFIG, ...pruneBlank(stored) } : DEFAULT_DRAFT_CONFIG;
  } catch {
    return DEFAULT_DRAFT_CONFIG;
  }
}

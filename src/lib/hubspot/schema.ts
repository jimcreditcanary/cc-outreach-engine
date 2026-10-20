// HubSpot property-schema helpers. Two jobs:
//  1. Schema-aware reads — only request properties that actually exist, so a
//     not-yet-created custom prop (e.g. onboarding_status before you add it in
//     HubSpot) never 400s the whole read. New props light up automatically the
//     moment they exist.
//  2. Live enum options — edit dropdowns read their choices straight from the
//     property definition, so we never hardcode option values.
// All backed by one cached GET per object type (hsFetch TTL-caches it).

import { hsFetch } from "./client";

export type HsObjectType = "companies" | "contacts" | "deals";

interface HsPropDef {
  name: string;
  label: string;
  type: string;
  fieldType?: string;
  options?: { label: string; value: string; hidden?: boolean }[];
}

const PROPS_TTL = 10 * 60 * 1000; // 10 min

async function propDefs(obj: HsObjectType): Promise<HsPropDef[]> {
  try {
    const res = await hsFetch<{ results: HsPropDef[] }>(`/crm/v3/properties/${obj}`, { cacheTtl: PROPS_TTL });
    return res.results ?? [];
  } catch {
    return [];
  }
}

/** Keep only the desired property names that exist on the object. Order is
 *  preserved. If the schema fetch fails, falls back to the desired list. */
export async function safeProps(obj: HsObjectType, desired: readonly string[]): Promise<string[]> {
  const defs = await propDefs(obj);
  if (defs.length === 0) return [...desired];
  const known = new Set(defs.map((p) => p.name));
  return desired.filter((p) => known.has(p));
}

/** The visible {label,value} options for an enumeration property (empty if the
 *  property doesn't exist yet). */
export async function propOptions(obj: HsObjectType, name: string): Promise<{ label: string; value: string }[]> {
  const defs = await propDefs(obj);
  const def = defs.find((p) => p.name === name);
  return (def?.options ?? []).filter((o) => !o.hidden).map((o) => ({ label: o.label, value: o.value }));
}

/** Map a stored enum value to its human label (falls back to the value). */
export async function optionLabel(obj: HsObjectType, name: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  const opts = await propOptions(obj, name);
  return opts.find((o) => o.value === value)?.label ?? value;
}

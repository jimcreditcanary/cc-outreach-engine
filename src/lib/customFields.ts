// Custom fields plumbing — shared between the section component (which
// reads defs to render inputs) and the entity update actions (which read
// defs to know which form values to collect + how to coerce them).

import { serviceClient } from "./db/client";

export type EntityType = "organisation" | "contact" | "deal";
export type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

export interface CustomFieldDef {
  id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options: string[];
  display_order: number;
}

type DB = ReturnType<typeof serviceClient>;

/** Lower-case, underscore-separated machine name. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

export async function loadCustomFieldDefs(db: DB, entityType: EntityType): Promise<CustomFieldDef[]> {
  const { data } = await db
    .from("custom_field_defs")
    .select("id, field_key, field_label, field_type, options, display_order")
    .eq("entity_type", entityType)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as CustomFieldDef[];
}

/** Pull all `custom_<key>` values out of a FormData and coerce them by type. */
export function parseCustomFieldsFromForm(
  formData: FormData,
  defs: CustomFieldDef[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = formData.get(`custom_${def.field_key}`);
    if (def.field_type === "checkbox") {
      out[def.field_key] = raw === "on" || raw === "true";
    } else if (def.field_type === "number") {
      const s = String(raw ?? "").trim();
      const n = Number(s);
      out[def.field_key] = s === "" || !Number.isFinite(n) ? null : n;
    } else {
      const s = String(raw ?? "").trim();
      out[def.field_key] = s === "" ? null : s;
    }
  }
  return out;
}

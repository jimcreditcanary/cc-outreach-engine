// Two halves to keep HTML valid (you can't nest <form>):
//
//   <CustomFieldInputs />   goes INSIDE the entity's edit <form> — renders
//                           the value inputs so they save with the entity.
//
//   <CustomFieldsManager /> goes OUTSIDE that form — lets the operator
//                           add new fields or remove existing ones.
//
// Both read the same custom_field_defs table.

import { serviceClient } from "@/lib/db/client";
import { loadCustomFieldDefs, type EntityType } from "@/lib/customFields";
import { addCustomFieldDef, deleteCustomFieldDef } from "@/app/actions";
import { ConfirmSubmit } from "./ConfirmSubmit";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

const FIELD_TYPES: { v: string; label: string }[] = [
  { v: "text", label: "Text" },
  { v: "textarea", label: "Long text" },
  { v: "number", label: "Number" },
  { v: "date", label: "Date" },
  { v: "select", label: "Dropdown" },
  { v: "checkbox", label: "Checkbox" },
];

/** Renders one input per registered custom field. Drop INSIDE the entity's
 *  existing edit form so the values save together. */
export async function CustomFieldInputs({
  entityType,
  values,
}: {
  entityType: EntityType;
  values: Record<string, unknown> | null | undefined;
}) {
  const defs = await loadCustomFieldDefs(serviceClient(), entityType);
  if (defs.length === 0) return null;
  const vals = values ?? {};

  return (
    <div className="col-span-2 mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
      {defs.map((d) => {
        const val = vals[d.field_key] ?? "";
        return (
          <div key={d.id}>
            <label className={lbl}>{d.field_label}</label>
            {d.field_type === "textarea" ? (
              <textarea name={`custom_${d.field_key}`} defaultValue={String(val ?? "")} rows={3} className={field} />
            ) : d.field_type === "checkbox" ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  id={`custom_${d.field_key}`}
                  type="checkbox"
                  name={`custom_${d.field_key}`}
                  defaultChecked={val === true || val === "true"}
                  className="h-4 w-4"
                />
                <label htmlFor={`custom_${d.field_key}`} className="text-sm text-neutral-700">{d.field_label}</label>
              </div>
            ) : d.field_type === "select" ? (
              <select name={`custom_${d.field_key}`} defaultValue={String(val ?? "")} className={field}>
                <option value="">—</option>
                {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={d.field_type === "number" ? "number" : d.field_type === "date" ? "date" : "text"}
                name={`custom_${d.field_key}`}
                defaultValue={String(val ?? "")}
                className={field}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Lists every custom field schema entry with a remove button + an "+ Add"
 *  details panel. Place OUTSIDE the entity's edit form. */
export async function CustomFieldsManager({ entityType }: { entityType: EntityType }) {
  const defs = await loadCustomFieldDefs(serviceClient(), entityType);
  return (
    <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Custom fields — schema
      </h3>

      {defs.length === 0 ? (
        <p className="mb-3 text-xs text-neutral-400">
          None yet. Add one below — it&apos;ll appear on every {entityType}.
        </p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {defs.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1.5">
              <span>
                <span className="font-medium text-neutral-800">{d.field_label}</span>{" "}
                <span className="text-xs text-neutral-500">· {d.field_type}{d.field_type === "select" && d.options.length ? ` (${d.options.join(", ")})` : ""}</span>
              </span>
              <form action={deleteCustomFieldDef}>
                <input type="hidden" name="id" value={d.id} />
                <ConfirmSubmit
                  className="rounded border border-red-200 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  message={`Remove the "${d.field_label}" field for all ${entityType}s? Stored values remain in the DB but stop showing.`}
                >
                  remove
                </ConfirmSubmit>
              </form>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded border border-dashed border-neutral-300 p-3">
        <summary className="cursor-pointer text-sm text-neutral-600">+ Add a custom field</summary>
        <form action={addCustomFieldDef} className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_2fr_auto] md:items-end">
          <input type="hidden" name="entity_type" value={entityType} />
          <div>
            <label className={lbl}>Label</label>
            <input name="field_label" required placeholder="e.g. Renewal date" className={field} />
          </div>
          <div>
            <label className={lbl}>Type</label>
            <select name="field_type" defaultValue="text" className={field}>
              {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Options <span className="text-neutral-400">(dropdown only — comma-separated)</span></label>
            <input name="options" placeholder="High, Medium, Low" className={field} />
          </div>
          <button className="h-9 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            Add
          </button>
        </form>
      </details>
    </section>
  );
}

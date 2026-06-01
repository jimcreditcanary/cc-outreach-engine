// Dropdown for assigning an entity (company / contact / deal) to an operator.
// Renders as a labelled <select name="owner_id"> so it slots into the entity's
// existing edit <form> and saves via the existing update action.

import { listOperators, currentUserId } from "@/lib/auth/owner";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export async function OwnerPicker({ value }: { value: string | null }) {
  const [operators, me] = await Promise.all([listOperators(), currentUserId()]);
  // If the row had no owner yet, suggest the signed-in operator as default.
  const selected = value ?? me ?? "";
  return (
    <div>
      <label className={lbl}>Owner</label>
      <select name="owner_id" defaultValue={selected} className={field}>
        <option value="">— unassigned —</option>
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.email ?? o.id}{o.id === me ? " (you)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

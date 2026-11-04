"use client";

// Step-3 role assignment (feedback items 2 + 3): pick a contact, then tick the
// role(s) — the checkboxes only appear once a contact is chosen, which is
// clearer than a multi-select. Contacts that already hold a role are filtered
// out by the server (to change them, remove the role and re-add).

import { useState } from "react";
import { PendingButton } from "@/components/PendingButton";

interface ContactOpt { id: string; name: string; title?: string }
interface RoleOpt { key: string; label: string }

export function AssignRoleForm({ caseId, contacts, roles, action }: {
  caseId: string;
  contacts: ContactOpt[];
  roles: RoleOpt[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [contactId, setContactId] = useState("");

  if (contacts.length === 0) {
    return <p className="text-xs text-neutral-400">All contacts already have a role. Add a new contact below, or remove a role above to reassign.</p>;
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <input type="hidden" name="case_id" value={caseId} />
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Contact</label>
        <select name="contact_id" value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm">
          <option value="" disabled>Pick a contact…</option>
          {contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}{ct.title ? ` - ${ct.title}` : ""}</option>)}
        </select>
      </div>

      {contactId && (
        <fieldset>
          <legend className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Role(s)</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.key} className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm">
                <input type="checkbox" name="roles" value={r.key} /> {r.label}
              </label>
            ))}
          </div>
          <div className="mt-2">
            <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Adding…">+ Assign role(s)</PendingButton>
          </div>
        </fieldset>
      )}
    </form>
  );
}

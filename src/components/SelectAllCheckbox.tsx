"use client";

// Header checkbox that toggles every row checkbox named `name` within the same
// <form>. Pure DOM — no shared React state, so it works over a server-rendered
// table. The bulk-edit bar submits whichever boxes end up checked.

export function SelectAllCheckbox({ name = "ids" }: { name?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        if (!form) return;
        form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((el) => {
          el.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}

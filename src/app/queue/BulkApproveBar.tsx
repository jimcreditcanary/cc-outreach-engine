"use client";

// Tiny client component for the bulk-approve toolbar. The form itself is a
// plain <form action={bulkApproveDrafts}> rendered by the parent (server)
// page — this component just gives it a live count + Select-all / Clear
// buttons that flip the checkboxes (which live inside each draft card via
// the `form="bulk-approve"` HTML attribute).

import { useEffect, useState } from "react";
import { PendingButton } from "@/components/PendingButton";

export function BulkApproveBar({ total }: { total: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => {
      const checked = document.querySelectorAll<HTMLInputElement>('input[name="draft_id"][form="bulk-approve"]:checked').length;
      setCount(checked);
    };
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);

  const selectAll = (on: boolean) => {
    const boxes = document.querySelectorAll<HTMLInputElement>('input[name="draft_id"][form="bulk-approve"]');
    boxes.forEach((b) => { b.checked = on; });
    setCount(on ? boxes.length : 0);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <span className="font-medium text-emerald-900">Outbox</span>
      <span className="text-emerald-700">{count} of {total} selected</span>
      <button type="button" onClick={() => selectAll(true)}  className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100">Select all</button>
      <button type="button" onClick={() => selectAll(false)} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100">Clear</button>
      <span className="ml-auto" />
      <PendingButton
        form="bulk-approve"
        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        pendingLabel="Approving…"
        disabled={count === 0}
      >
        ✓ Approve selected
      </PendingButton>
    </div>
  );
}

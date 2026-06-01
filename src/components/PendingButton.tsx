"use client";

// Submit button that knows when its parent <form> is in-flight. Disables
// itself, swaps to the pending label, and shows a tiny spinner — so any
// AI-heavy server action (upload, generate, send, answer) has visible
// progress instead of looking frozen.

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function PendingButton({
  children,
  pendingLabel = "Working…",
  className,
  formAction,
  title,
  form,
  disabled,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  formAction?: (formData: FormData) => Promise<void> | void;
  title?: string;
  /** Associate this button with a <form id="..."> elsewhere in the document. */
  form?: string;
  /** Force-disable independent of pending (e.g. "nothing selected yet"). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      formAction={formAction}
      disabled={pending || disabled}
      title={title}
      form={form}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

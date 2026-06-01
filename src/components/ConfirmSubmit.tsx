"use client";

// Confirm-before-submit button that ALSO shows a pending state via
// useFormStatus — so deletes feel responsive and the misclick guard is
// still in place. Spinner appears the moment the user confirms.

import { useFormStatus } from "react-dom";
import type { MouseEvent, ReactNode } from "react";

export function ConfirmSubmit({
  children,
  formAction,
  className,
  message = "Are you sure? This can't be undone.",
}: {
  children: ReactNode;
  formAction?: (formData: FormData) => Promise<void> | void;
  className?: string;
  message?: string;
}) {
  const { pending } = useFormStatus();
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (pending) return; // already in flight
    if (!window.confirm(message)) e.preventDefault();
  };
  return (
    <button
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      formAction={formAction}
      onClick={onClick}
      disabled={pending}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
          Working…
        </span>
      ) : (
        children
      )}
    </button>
  );
}

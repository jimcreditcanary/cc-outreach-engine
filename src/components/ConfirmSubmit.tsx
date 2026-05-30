"use client";

// Tiny client wrapper that fires a native confirm() before submitting a
// destructive server action. Used for every delete/merge so a misclick can't
// nuke a company/contact/deal/note. The server action is passed in as a
// prop — works because Next serialises the action reference.

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
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(message)) e.preventDefault();
  };
  return (
    <button className={className} formAction={formAction} onClick={onClick}>
      {children}
    </button>
  );
}

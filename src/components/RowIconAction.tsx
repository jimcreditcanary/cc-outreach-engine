"use client";

// Single-source-of-truth icon button for in-row CRM actions. Use this
// EVERYWHERE a small destructive / row-level action lives in a table or
// list — delete, remove, dismiss, restore. Don't reach for ad-hoc text
// buttons. Keeping it one component is the only way the UI stays visually
// consistent as pages multiply.
//
//   <RowIconAction kind="delete" confirmMessage="Delete X?" formAction={...} />
//   <RowIconAction kind="remove" formAction={...} />              // no confirm
//   <RowIconAction kind="dismiss" formAction={...} />             // alerts etc.
//
// All variants render as an 8x8 bordered chip — neutral by default, tinted
// the variant's colour on hover. Width is fixed so columns line up across
// pages. Wraps the existing ConfirmSubmit behaviour so destructive actions
// get a misclick guard + pending-state spinner.

import { useFormStatus } from "react-dom";
import type { MouseEvent } from "react";
import { Trash2, X, Check, RotateCcw, Edit3 } from "lucide-react";

type Kind = "delete" | "remove" | "dismiss" | "restore" | "edit";

const VARIANTS: Record<Kind, {
  Icon: typeof Trash2;
  hover: string;
  defaultTitle: string;
  defaultConfirm: boolean;
}> = {
  delete:  { Icon: Trash2,    hover: "hover:border-red-300 hover:bg-red-50 hover:text-red-600",            defaultTitle: "Delete",  defaultConfirm: true  },
  remove:  { Icon: X,         hover: "hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700",      defaultTitle: "Remove",  defaultConfirm: false },
  dismiss: { Icon: Check,     hover: "hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700", defaultTitle: "Dismiss", defaultConfirm: false },
  restore: { Icon: RotateCcw, hover: "hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600",          defaultTitle: "Restore", defaultConfirm: false },
  edit:    { Icon: Edit3,     hover: "hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600",          defaultTitle: "Edit",    defaultConfirm: false },
};

export function RowIconAction({
  kind,
  formAction,
  title,
  confirmMessage,
}: {
  kind: Kind;
  formAction?: (formData: FormData) => Promise<void> | void;
  /** Tooltip; defaults to the variant's verb. */
  title?: string;
  /** If provided (or if kind=delete and not set), shows a confirm() dialog
   *  first. Pass "" to explicitly skip the confirm even for delete. */
  confirmMessage?: string;
}) {
  const v = VARIANTS[kind];
  const { pending } = useFormStatus();
  const willConfirm = confirmMessage !== "" && (confirmMessage || v.defaultConfirm);
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (pending) return;
    if (willConfirm && !window.confirm(confirmMessage || "Are you sure? This can't be undone.")) {
      e.preventDefault();
    }
  };
  const Icon = v.Icon;
  return (
    <button
      type="submit"
      formAction={formAction}
      onClick={onClick}
      disabled={pending}
      title={title ?? v.defaultTitle}
      aria-label={title ?? v.defaultTitle}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-400 transition-colors ${v.hover} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
      ) : (
        <Icon size={14} strokeWidth={1.75} />
      )}
    </button>
  );
}

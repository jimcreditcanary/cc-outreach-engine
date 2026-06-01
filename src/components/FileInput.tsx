// Standardised file picker. The native <input type="file"> ships with an
// ugly system-default button that doesn't match anything else in the CRM.
// This wrapper applies the `file:` Tailwind utilities to give it the same
// outlined-button look as the rest of the UI, plus a sensible hover state.
//
// Same standing principle as RowIconAction: every file input in the app
// should reach for <FileInput> so the look stays identical as pages
// multiply. Don't roll a new `<input type="file">` from scratch.

import type { InputHTMLAttributes } from "react";

export function FileInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const base =
    "text-sm text-neutral-600 " +
    // The button-half (the bit the browser renders as a button)
    "file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-neutral-300 " +
    "file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 " +
    "hover:file:border-neutral-400 hover:file:bg-neutral-100 " +
    // Disabled state mirrors PendingButton / RowIconAction
    "disabled:cursor-not-allowed disabled:opacity-60";
  return <input type="file" className={`${base} ${className ?? ""}`} {...rest} />;
}

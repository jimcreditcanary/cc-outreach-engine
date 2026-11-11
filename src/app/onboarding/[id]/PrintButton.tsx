"use client";

// Print / Save-as-PDF for the onboarding review page. The browser's print dialog
// offers "Save as PDF"; print styles in globals.css (@media print) strip the app
// chrome so only the review content prints.
export function PrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className ?? "rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"}
    >
      🖨 Print / Save as PDF
    </button>
  );
}

"use client";

// Small copy-to-clipboard button. Shows a brief "Copied" confirmation. Falls
// back silently if the clipboard API is unavailable (e.g. insecure context).

import { useState } from "react";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      className={className ?? "rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"}
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

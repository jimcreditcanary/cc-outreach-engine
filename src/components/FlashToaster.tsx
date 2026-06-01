"use client";

// Pops a sonner toast whenever the server set a `flash` cookie. Reads on
// every navigation (pathname + searchParams change) and immediately clears
// the cookie so the same toast doesn't fire twice.

import { useEffect } from "react";
import { Toaster, toast } from "sonner";

function FlashReader() {
  // Run after every render (not just on navigation) so that server actions
  // which only revalidate the current path still surface their toast. We
  // clear the cookie immediately after firing, so subsequent renders no-op.
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)flash=([^;]+)/);
    if (!m) return;
    const raw = decodeURIComponent(m[1] ?? "");
    const idx = raw.indexOf(":");
    const kind = idx >= 0 ? raw.slice(0, idx) : "info";
    const msg = idx >= 0 ? raw.slice(idx + 1) : raw;
    if (kind === "success") toast.success(msg);
    else if (kind === "error") toast.error(msg);
    else toast.info(msg);
    document.cookie = "flash=; max-age=0; path=/";
  });
  return null;
}

export function FlashToaster() {
  return (
    <>
      <FlashReader />
      <Toaster richColors position="bottom-right" closeButton duration={3500} />
    </>
  );
}

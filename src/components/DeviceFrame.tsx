"use client";

// The right-hand viewport on a demo landing page: a desktop/mobile toggle
// wrapping a device-shaped frame. The branded journey screen is passed as
// children (rendered on the server, themed to the prospect) so this stays a
// thin client shell that just swaps the frame chrome around it.

import { useState } from "react";

export function DeviceFrame({ brand, children }: { brand: string; children: React.ReactNode }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="inline-flex rounded-full border border-neutral-200 bg-white p-1 text-xs font-medium shadow-sm">
        {(["desktop", "mobile"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDevice(d)}
            className={`rounded-full px-4 py-1.5 capitalize transition-colors ${device === d ? "text-white" : "text-neutral-500 hover:text-neutral-800"}`}
            style={device === d ? { backgroundColor: brand } : undefined}
          >
            {d}
          </button>
        ))}
      </div>

      {device === "mobile" ? (
        // Phone: rounded chassis + notch, the screen scrolls inside.
        <div className="relative h-[640px] w-[312px] rounded-[2.5rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl">
          <div className="absolute left-1/2 top-0 z-10 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-neutral-900" />
          <div className="h-full w-full overflow-y-auto rounded-[1.8rem] bg-white">{children}</div>
        </div>
      ) : (
        // Desktop: browser window; the mobile-first journey sits centred.
        <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            <span className="ml-3 flex-1 rounded bg-white px-3 py-1 text-center text-[11px] text-neutral-400 shadow-inner">apply.creditcanary.co.uk</span>
          </div>
          <div className="h-[520px] overflow-y-auto bg-neutral-50 py-8">{children}</div>
        </div>
      )}

      <p className="text-xs text-neutral-400">Live, branded application journey — toggle desktop / mobile</p>
    </div>
  );
}

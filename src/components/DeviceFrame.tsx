"use client";

// The right-hand viewport on a demo landing page: a desktop/mobile toggle
// wrapping a device-shaped frame. The frame currently shows a branded
// placeholder of the origination console — the real journeys get rendered
// here once the Figma flows are supplied.

import { useState } from "react";

export function DeviceFrame({
  brand,
  fg,
  logo,
  productType,
  companyName,
}: {
  brand: string;
  fg: string; // readable text colour on `brand`
  logo: string | null;
  productType: string | null;
  companyName: string;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  return (
    <div className="flex w-full flex-col items-center gap-4">
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

      <div
        className={`overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl transition-all duration-300 ${
          device === "desktop" ? "aspect-[16/10] w-full max-w-2xl" : "aspect-[9/19] w-[300px]"
        }`}
      >
        {/* Branded console chrome */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: brand, color: fg }}>
          {logo ? (
            <img src={logo} alt="" className="h-5 max-w-[120px] object-contain" />
          ) : (
            <span className="text-sm font-semibold">{companyName}</span>
          )}
          <span className="ml-auto text-[10px] opacity-80">{productType ?? "Application"}</span>
        </div>

        {/* Placeholder journey — replaced by the real flow once supplied */}
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="h-2.5 w-2/3 rounded bg-neutral-200" />
          <div className="h-2 w-1/2 rounded bg-neutral-100" />
          <div className="mt-2 space-y-2">
            <div className="h-9 rounded-lg border border-neutral-200 bg-neutral-50" />
            <div className="h-9 rounded-lg border border-neutral-200 bg-neutral-50" />
            <div className="h-9 rounded-lg border border-neutral-200 bg-neutral-50" />
          </div>
          <div className="mt-auto">
            <div className="h-10 rounded-lg text-center text-sm font-semibold leading-10 text-white" style={{ backgroundColor: brand, color: fg }}>
              Continue
            </div>
            <p className="mt-3 text-center text-[11px] text-neutral-400">Live {productType ?? ""} journey renders here</p>
          </div>
        </div>
      </div>
    </div>
  );
}

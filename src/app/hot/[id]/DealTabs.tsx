"use client";

// Tab shell for the Work-Deal page. Server-rendered panel content is passed in
// as `content` (ReactNode) per tab, so each panel — including the Qualification
// panel's streamed MEDDICC <Suspense> — renders on the server exactly as before.
// Switching tabs just toggles a `hidden` class, so panels stay mounted and
// nothing re-fetches or re-streams on switch.

import { useState } from "react";

export interface DealTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export function DealTabs({ tabs }: { tabs: DealTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-neutral-200">
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              aria-current={on ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                on ? "border-amber-600 text-amber-800" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? "" : "hidden"} role="tabpanel" aria-hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

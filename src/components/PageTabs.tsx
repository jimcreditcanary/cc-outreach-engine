"use client";

// Horizontal sub-tab bar for a combined destination (e.g. CRM = Companies +
// Contacts, Research = Alerts + Content + …). Each tab is a route link; the
// active one is derived from the pathname, or set explicitly (for same-route,
// query-param tabs like Workflow's Outreach/Nurture).

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface PageTab {
  href: string;
  label: string;
  /** Override pathname-based active detection (for ?tab= style tabs). */
  active?: boolean;
}

export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex gap-1 border-b border-neutral-200">
      {tabs.map((t) => {
        const base = t.href.split("?")[0];
        const active = t.active ?? (pathname === base || pathname.startsWith(base + "/"));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-amber-600 text-amber-800"
                : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// Shared tab definitions so every page in a group renders the same bar.
export const CRM_TABS: PageTab[] = [
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
];

export const RESEARCH_TABS: PageTab[] = [
  { href: "/alerts", label: "Alerts" },
  { href: "/content", label: "Content" },
  { href: "/linkedin", label: "LinkedIn" },
  { href: "/events", label: "Events" },
];

export const SETTINGS_TABS: PageTab[] = [
  { href: "/settings", label: "Setup" },
  { href: "/admin/users", label: "Users" },
];

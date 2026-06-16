"use client";

// Sidebar layout shell for authenticated pages. Cookie-backed collapse so
// the choice persists across requests. Active route is highlighted via
// usePathname so it reflects client-side navigation too.
//
// Nav is FLAT under section headers (no accordions): every destination is an
// always-visible, always-clickable link. When the sidebar is collapsed to
// icons, the headers become thin dividers and every item stays reachable as
// an icon with a hover tooltip — nothing hides behind an expander.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  Flame,
  UserPlus,
  Building2,
  Users as UsersIcon,
  Briefcase,
  Mail,
  Reply,
  Calendar,
  CalendarRange,
  UserCog,
  Bell,
  Send,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from "lucide-react";
import { logoutAction } from "@/app/auth-actions";

type LucideIcon = typeof LayoutDashboard;

interface Leaf {
  href: string;
  label: string;
  Icon: LucideIcon;
}

interface Section {
  header: string;
  items: Leaf[];
}

// Flat sections — headers are labels, not toggles. Every item is a direct link.
const SECTIONS: Section[] = [
  {
    header: "CRM",
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/companies", label: "Companies", Icon: Building2 },
      { href: "/contacts",  label: "Contacts",  Icon: UsersIcon },
    ],
  },
  {
    header: "Pipeline",
    items: [
      { href: "/deals", label: "Deals", Icon: Briefcase },
      { href: "/hot",   label: "Hot",   Icon: Flame },
    ],
  },
  {
    header: "Activities",
    items: [
      { href: "/meetings", label: "Meetings", Icon: Calendar },
      { href: "/events",   label: "Events",   Icon: CalendarRange },
    ],
  },
  {
    header: "Research",
    items: [
      { href: "/alerts",   label: "Alerts",   Icon: Bell },
      { href: "/linkedin", label: "LinkedIn", Icon: UserPlus },
    ],
  },
  {
    header: "Outreach",
    items: [
      { href: "/sequences",  label: "Sequences",  Icon: Send },
      { href: "/newsletter", label: "Newsletter", Icon: Mail },
      { href: "/queue",      label: "Queue",      Icon: Inbox },
      { href: "/replies",    label: "Replies",    Icon: Reply },
    ],
  },
  {
    header: "Settings",
    items: [
      { href: "/settings",    label: "Setup", Icon: SettingsIcon },
      { href: "/admin/users", label: "Users", Icon: UserCog },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

export function AppShell({
  initialCollapsed,
  userEmail,
  children,
}: {
  initialCollapsed: boolean;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();

  // Persist collapse choice for next page load.
  useEffect(() => {
    document.cookie = `sidebar=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  const sideW = collapsed ? "w-16" : "w-56";
  const mainOffset = collapsed ? "ml-16" : "ml-56";

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside
        className={`fixed inset-y-0 left-0 z-20 flex ${sideW} flex-col border-r border-neutral-200 bg-white shadow-sm transition-[width] duration-200`}
      >
        <div className={`flex h-14 items-center border-b border-neutral-100 px-3 ${collapsed ? "justify-center" : "gap-2"}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-600 text-sm font-bold text-white">
            CC
          </div>
          {!collapsed && <span className="truncate font-semibold text-neutral-800">Credit Canary</span>}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {SECTIONS.map((section, i) => (
            <div key={section.header} className={i > 0 ? "mt-4" : ""}>
              {collapsed ? (
                // No room for a label — a hairline divider keeps the grouping
                // legible (skipped before the first section).
                i > 0 && <div className="mx-1 mb-2 border-t border-neutral-100" />
              ) : (
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  {section.header}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((leaf) => (
                  <LeafLink key={leaf.href} leaf={leaf} active={isActive(pathname, leaf.href)} collapsed={collapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-neutral-100 p-2">
          <form action={logoutAction}>
            <button
              type="submit"
              className={`group relative flex w-full items-center rounded-md px-2 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 ${
                collapsed ? "justify-center" : "gap-3"
              }`}
              title={collapsed ? `Log out (${userEmail})` : undefined}
            >
              <LogOut size={18} strokeWidth={1.75} className="shrink-0" />
              {!collapsed && <span className="truncate text-xs">{userEmail}</span>}
              {collapsed && (
                <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                  Log out · {userEmail}
                </span>
              )}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mt-1 flex w-full items-center justify-center rounded-md px-2 py-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </aside>

      <div className={`${mainOffset} transition-[margin-left] duration-200`}>{children}</div>
    </div>
  );
}

function LeafLink({ leaf, active, collapsed }: { leaf: Leaf; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={leaf.href}
      className={`group relative flex items-center rounded-md px-2 py-2 text-sm transition-colors ${
        active ? "bg-amber-50 font-medium text-amber-800" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      } ${collapsed ? "justify-center" : "gap-3"}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? leaf.label : undefined}
    >
      <leaf.Icon size={18} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
      {!collapsed && <span className="truncate">{leaf.label}</span>}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
          {leaf.label}
        </span>
      )}
    </Link>
  );
}

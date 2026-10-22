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
  Building2,
  Briefcase,
  Mail,
  Reply,
  Telescope,
  Megaphone,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { logoutAction } from "@/app/auth-actions";

type LucideIcon = typeof Building2;

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
// Several destinations are now combined views with their own in-page tabs:
//   CRM      → Companies + Contacts
//   Research → Alerts + Content + LinkedIn + Events
//   Workflow → Outreach + Nurture
//   Settings → Setup + Users
const SECTIONS: Section[] = [
  {
    header: "Pipeline",
    items: [
      { href: "/companies", label: "CRM",   Icon: Building2 },
      { href: "/deals",     label: "Deals", Icon: Briefcase },
    ],
  },
  {
    header: "Outreach",
    items: [
      { href: "/outreach",   label: "Workflow",   Icon: Megaphone },
      { href: "/alerts",     label: "Research",   Icon: Telescope },
      { href: "/replies",    label: "Replies",    Icon: Reply },
      { href: "/newsletter", label: "Newsletter", Icon: Mail },
    ],
  },
  {
    header: "Admin",
    items: [
      { href: "/settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
];

// Grouped destinations: a nav item stays highlighted across all the routes that
// live under its combined view (so "CRM" lights up on /contacts too).
const GROUPED: Record<string, string[]> = {
  "/companies": ["/companies", "/contacts"],
  "/alerts": ["/alerts", "/content", "/linkedin", "/events"],
  "/settings": ["/settings", "/admin/users"],
};

function isActive(pathname: string, href: string): boolean {
  const routes = GROUPED[href] ?? [href];
  return routes.some((r) => pathname === r || (r !== "/" && pathname.startsWith(r + "/")));
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

  const [mobileOpen, setMobileOpen] = useState(false);

  const sideW = collapsed ? "w-16" : "w-56";
  const mainOffset = collapsed ? "md:ml-16" : "md:ml-56";

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Mobile top bar (hidden on md+) */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-neutral-200 bg-white px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="-ml-1 rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100"
        >
          <Menu size={22} />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-600 text-sm font-bold text-white">CC</div>
        <span className="font-semibold text-neutral-800">Credit Canary</span>
      </header>

      {/* Desktop sidebar (hidden below md) */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden ${sideW} flex-col border-r border-neutral-200 bg-white shadow-sm transition-[width] duration-200 md:flex`}
      >
        <SidebarBody collapsed={collapsed} pathname={pathname} userEmail={userEmail} onToggleCollapse={() => setCollapsed((c) => !c)} />
      </aside>

      {/* Mobile drawer + backdrop */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-neutral-200 bg-white shadow-xl transition-transform duration-200 md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute right-2 top-3 z-10 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
        >
          <X size={20} />
        </button>
        <SidebarBody collapsed={false} pathname={pathname} userEmail={userEmail} onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Content — full width on mobile (below the top bar), offset on desktop */}
      <div className={`pt-14 md:pt-0 ${mainOffset} transition-[margin-left] duration-200`}>{children}</div>
    </div>
  );
}

// Shared sidebar contents, used by both the desktop rail and the mobile drawer.
function SidebarBody({
  collapsed, pathname, userEmail, onNavigate, onToggleCollapse,
}: {
  collapsed: boolean;
  pathname: string;
  userEmail: string;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <>
      <div className={`flex h-14 items-center border-b border-neutral-100 px-3 ${collapsed ? "justify-center" : "gap-2"}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-600 text-sm font-bold text-white">CC</div>
        {!collapsed && <span className="truncate font-semibold text-neutral-800">Credit Canary</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section, i) => (
          <div key={section.header} className={i > 0 ? "mt-4" : ""}>
            {collapsed ? (
              i > 0 && <div className="mx-1 mb-2 border-t border-neutral-100" />
            ) : (
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                {section.header}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((leaf) => (
                <LeafLink key={leaf.href} leaf={leaf} active={isActive(pathname, leaf.href)} collapsed={collapsed} onNavigate={onNavigate} />
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
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mt-1 flex w-full items-center justify-center rounded-md px-2 py-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        )}
      </div>
    </>
  );
}

function LeafLink({ leaf, active, collapsed, onNavigate }: { leaf: Leaf; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={leaf.href}
      onClick={onNavigate}
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

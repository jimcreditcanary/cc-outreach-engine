"use client";

// Sidebar layout shell for authenticated pages. Cookie-backed collapse so
// the choice persists across requests. Active route is highlighted via
// usePathname so it reflects client-side navigation too.
//
// Nav is grouped: top-level items render directly, group items expand into
// a sub-list. A group auto-opens when the active route is one of its
// children, so a fresh page-load lands with the right section open.

import { useState, useEffect, useMemo } from "react";
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
  Calendar,
  CalendarRange,
  UserCog,
  Bell,
  Search,
  Send,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
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

interface Group {
  label: string;
  Icon: LucideIcon;
  /** Stable id for the open/close cookie. */
  key: string;
  children: Leaf[];
}

type NavEntry = Leaf | Group;

function isGroup(n: NavEntry): n is Group {
  return (n as Group).children !== undefined;
}

const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  {
    key: "pipeline", label: "Pipeline", Icon: Briefcase,
    children: [
      { href: "/deals", label: "Deals", Icon: Briefcase },
      { href: "/hot",   label: "Hot",   Icon: Flame },
    ],
  },
  { href: "/companies", label: "Companies", Icon: Building2 },
  { href: "/contacts",  label: "Contacts",  Icon: UsersIcon },
  {
    key: "activities", label: "Activities", Icon: Calendar,
    children: [
      { href: "/meetings", label: "Meetings", Icon: Calendar },
      { href: "/events",   label: "Events",   Icon: CalendarRange },
    ],
  },
  {
    key: "research", label: "Research", Icon: Search,
    children: [
      { href: "/alerts",   label: "Alerts",   Icon: Bell },
      { href: "/linkedin", label: "LinkedIn", Icon: UserPlus },
    ],
  },
  {
    key: "outreach", label: "Outreach", Icon: Send,
    children: [
      { href: "/newsletter", label: "Newsletter", Icon: Mail },
      { href: "/queue",      label: "Queue",      Icon: Inbox },
    ],
  },
  {
    key: "settings", label: "Settings", Icon: SettingsIcon,
    children: [
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

  // Group open/closed state. Defaults to "auto-open the one containing the
  // current route" so nav always reveals where you are. The user can flip
  // any group manually; we keep state in component memory (resets per
  // hard-load, which is fine — auto-open re-resolves correctly).
  const initialOpen = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const n of NAV) {
      if (isGroup(n)) out[n.key] = n.children.some((c) => isActive(pathname, c.href));
    }
    return out;
  }, [pathname]);
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen);
  useEffect(() => { setOpen((cur) => ({ ...initialOpen, ...cur })); }, [initialOpen]);

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

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV.map((n) => {
            if (!isGroup(n)) {
              const active = isActive(pathname, n.href);
              return <LeafLink key={n.href} leaf={n} active={active} collapsed={collapsed} />;
            }
            const anyActive = n.children.some((c) => isActive(pathname, c.href));
            const isOpen = collapsed ? true : (open[n.key] ?? anyActive);
            return (
              <div key={n.key}>
                {collapsed ? (
                  // Collapsed: render the group header as a leaf that jumps
                  // to the first child + reveals its hover tooltip. Children
                  // can still be reached one level over after expanding.
                  <Link
                    href={n.children[0]?.href ?? "/"}
                    className={`group relative flex items-center justify-center rounded-md px-2 py-2 text-sm transition-colors ${
                      anyActive ? "bg-amber-50 font-medium text-amber-800" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                    }`}
                    aria-current={anyActive ? "page" : undefined}
                  >
                    <n.Icon size={18} strokeWidth={anyActive ? 2.25 : 1.75} className="shrink-0" />
                    <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                      {n.label}
                    </span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen((cur) => ({ ...cur, [n.key]: !isOpen }))}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                      anyActive ? "font-medium text-amber-800" : "text-neutral-700 hover:bg-neutral-100"
                    }`}
                    aria-expanded={isOpen}
                  >
                    <n.Icon size={18} strokeWidth={anyActive ? 2.25 : 1.75} className="shrink-0" />
                    <span className="flex-1 truncate text-left">{n.label}</span>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
                {!collapsed && isOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-neutral-100 pl-2">
                    {n.children.map((c) => {
                      const active = isActive(pathname, c.href);
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={`group relative flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
                            active
                              ? "bg-amber-50 font-medium text-amber-800"
                              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                          }`}
                          aria-current={active ? "page" : undefined}
                        >
                          <c.Icon size={16} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
                          <span className="truncate">{c.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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

"use client";

// Sidebar layout shell for authenticated pages. Cookie-backed collapse so
// the choice persists across requests (initial value seeded by the server
// layout — no flash on first paint). Active route is highlighted via
// usePathname so it reflects client-side navigation too.

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
  Calendar,
  UserCog,
  Bell,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from "lucide-react";
import { logoutAction } from "@/app/auth-actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/queue", label: "Queue", Icon: Inbox },
  { href: "/hot", label: "Hot", Icon: Flame },
  { href: "/alerts", label: "Alerts", Icon: Bell },
  { href: "/linkedin", label: "LinkedIn", Icon: UserPlus },
  { href: "/companies", label: "Companies", Icon: Building2 },
  { href: "/contacts", label: "Contacts", Icon: UsersIcon },
  { href: "/deals", label: "Deals", Icon: Briefcase },
  { href: "/meetings", label: "Meetings", Icon: Calendar },
  { href: "/newsletter", label: "Newsletter", Icon: Mail },
  { href: "/admin/users", label: "Users", Icon: UserCog },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

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

  // Persist preference for next page load (no JS frameworks; just a cookie).
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
        {/* brand */}
        <div className={`flex h-14 items-center border-b border-neutral-100 px-3 ${collapsed ? "justify-center" : "gap-2"}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-600 text-sm font-bold text-white">
            CC
          </div>
          {!collapsed && <span className="truncate font-semibold text-neutral-800">Credit Canary</span>}
        </div>

        {/* nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
            return (
              <Link
                key={href}
                href={href}
                className={`group relative flex items-center rounded-md px-2 py-2 text-sm transition-colors ${
                  active
                    ? "bg-amber-50 font-medium text-amber-800"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                } ${collapsed ? "justify-center" : "gap-3"}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
                {collapsed && (
                  <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* user + collapse toggle */}
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

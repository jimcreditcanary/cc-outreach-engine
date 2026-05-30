import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "@/lib/auth/server";
import { logoutAction } from "./auth-actions";

export const metadata: Metadata = {
  title: "Credit Canary — Outreach",
  description: "Outreach engine operator console",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/queue", label: "Queue" },
  { href: "/linkedin", label: "LinkedIn" },
  { href: "/hot", label: "Hot" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
  { href: "/deals", label: "Deals" },
  { href: "/admin/users", label: "Users" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        {me && (
          <nav className="border-b border-neutral-200 bg-white">
            <div className="flex w-full items-center gap-4 px-[50px] py-3">
              <span className="font-semibold text-amber-700">Credit Canary</span>
              <span className="text-neutral-300">·</span>
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="text-sm text-neutral-600 hover:text-neutral-900">
                  {n.label}
                </a>
              ))}
              <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
                <a href="/admin/users" className="hover:text-neutral-900">{me.email}</a>
                <form action={logoutAction}>
                  <button className="hover:text-neutral-900">logout</button>
                </form>
              </div>
            </div>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}

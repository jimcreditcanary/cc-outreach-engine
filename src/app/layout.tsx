import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { currentUser } from "@/lib/auth/server";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Credit Canary — Outreach",
  description: "Outreach engine operator console",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const sidebarPref = (await cookies()).get("sidebar")?.value;
  const collapsed = sidebarPref === "collapsed";

  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {me ? (
          <AppShell initialCollapsed={collapsed} userEmail={me.email ?? ""}>
            {children}
          </AppShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}

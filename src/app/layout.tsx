import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credit Canary — Outreach",
  description: "Outreach engine operator console",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/queue", label: "Queue" },
  { href: "/t1", label: "T1" },
  { href: "/linkedin", label: "LinkedIn" },
  { href: "/replies", label: "Replies" },
  { href: "/hot", label: "Hot" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <nav className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
            <span className="font-semibold text-amber-700">Credit Canary</span>
            <span className="text-neutral-300">·</span>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm text-neutral-600 hover:text-neutral-900">
                {n.label}
              </a>
            ))}
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}

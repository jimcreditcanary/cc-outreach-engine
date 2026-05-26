import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credit Canary — Outreach",
  description: "Outreach engine operator console",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}

// Simple single-operator auth gate (brief §2 — "simple auth (just Jim)").
// A cookie-based password gate protecting the cockpit. Webhook and cron
// routes are exempt — they carry their own shared-secret tokens.
//
// If APP_PASSWORD is unset (local dev / preview), the gate is open.

import { NextRequest, NextResponse } from "next/server";

const COOKIE = "cc_auth";

function expectedToken(): string | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null; // gate disabled
  return process.env.APP_SESSION_SECRET || pw;
}

export function middleware(req: NextRequest) {
  const token = expectedToken();
  if (!token) return NextResponse.next(); // no password configured → open

  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/postmark") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  if (req.cookies.get(COOKIE)?.value === token) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Kick off the Microsoft OAuth dance. Generates a CSRF state in a cookie,
// redirects to Microsoft's authorise endpoint. Callback verifies the state.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { authorizeUrl } from "@/lib/microsoft/oauth";
import { randomBytes } from "node:crypto";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "https://cc-outreach-engine.vercel.app"));

  const state = randomBytes(16).toString("hex");
  const url = authorizeUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}

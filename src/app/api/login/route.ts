// Verify the operator password and set the auth cookie.

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const expected = process.env.APP_PASSWORD;
  const origin = new URL(req.url).origin;

  if (!expected || password !== expected) {
    return NextResponse.redirect(`${origin}/login?error=1`, { status: 303 });
  }

  const res = NextResponse.redirect(`${origin}/queue`, { status: 303 });
  res.cookies.set("cc_auth", process.env.APP_SESSION_SECRET || expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// Microsoft OAuth callback. Verifies the state cookie, exchanges the code
// for tokens, persists them, then bounces to /meetings.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { exchangeCode, saveTokens } from "@/lib/microsoft/oauth";

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error_description");
  if (err) return NextResponse.redirect(new URL(`/meetings?ms_error=${encodeURIComponent(err)}`, req.url));
  if (!code || !state) return NextResponse.redirect(new URL("/meetings?ms_error=missing-code", req.url));

  const expected = (await cookies()).get("ms_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/meetings?ms_error=bad-state", req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(serviceClient(), me.id, tokens);
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/meetings?ms_error=${encodeURIComponent((e as Error).message)}`, req.url),
    );
  }

  const res = NextResponse.redirect(new URL("/meetings?ms_connected=1", req.url));
  res.cookies.delete("ms_oauth_state");
  return res;
}

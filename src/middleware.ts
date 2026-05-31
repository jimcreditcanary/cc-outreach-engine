// Auth gate via Supabase Auth. Every request refreshes the session cookie
// and is redirected to /login unless authenticated. Webhook + cron routes
// carry their own shared-secret tokens and are exempt.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/postmark",
  "/api/cron",
  "/api/auth", // reserved for future OAuth callback if needed
  "/unsubscribe", // clicked from outreach emails — recipient isn't logged in
];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          for (const c of toSet) req.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: req });
          for (const c of toSet) response.cookies.set(c.name, c.value, c.options);
        },
      },
    },
  );

  // Refresh the JWT cookie if it expired; gives us the current user (or null).
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Bounce a signed-in user off /login → /queue.
  if (user && pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/queue";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

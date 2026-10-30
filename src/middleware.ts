// Auth gate via Supabase Auth. Every request refreshes the session cookie
// and is redirected to /login unless authenticated. Webhook + cron routes
// carry their own shared-secret tokens and are exempt.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/postmark",
  "/api/cron",
  "/api/leads", // external lead capture — guarded by its own LEAD_API_KEY
  "/api/inbound", // inbound signals (abandonment) — guarded by LEAD_API_KEY
  "/api/internal", // internal service hooks — guarded by CRON_SECRET bearer
  "/api/auth", // reserved for future OAuth callback if needed
  "/unsubscribe", // clicked from outreach emails — recipient isn't logged in
  "/book", // public booking pages — external visitors book meetings here
  "/enquire", // public inbound-lead landing page
  "/demo", // public branded prospect demo pages
  "/m", // public merchant onboarding form — guarded by its unguessable token
];

// Pages allowed inside an <iframe> — the embeddable lead/booking forms.
// Everything else gets frame-ancestors 'none' (clickjacking protection for
// the authed app). Extend the allow-list with the EMBED_ALLOWED_ORIGINS env
// var (space-separated origins) without a deploy-time code change.
const EMBEDDABLE_PREFIXES = ["/book", "/enquire"];
const EMBED_ANCESTORS = [
  "'self'",
  "https://creditcanary.co.uk",
  "https://www.creditcanary.co.uk",
  ...(process.env.EMBED_ALLOWED_ORIGINS?.split(/\s+/).filter(Boolean) ?? []),
].join(" ");

function withFrameHeaders(res: NextResponse, pathname: string): NextResponse {
  if (EMBEDDABLE_PREFIXES.some((p) => pathname.startsWith(p))) {
    res.headers.set("Content-Security-Policy", `frame-ancestors ${EMBED_ANCESTORS}`);
  } else {
    res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    res.headers.set("X-Frame-Options", "DENY");
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Branded merchant-form host (onboarding.creditcanary.co.uk, set via
  // ONBOARDING_FORM_HOST once its DNS is live). It serves ONLY the public
  // merchant form (/m/*) — the internal app is never exposed there. Everything
  // else on that host bounces to the main site. No session handling here (the
  // form is public). Inert until the env var is set.
  const brandedHost = process.env.ONBOARDING_FORM_HOST?.trim().toLowerCase();
  if (brandedHost) {
    const host = req.headers.get("host")?.split(":")[0]?.toLowerCase();
    if (host === brandedHost) {
      if (pathname.startsWith("/m")) return withFrameHeaders(NextResponse.next({ request: req }), pathname);
      return NextResponse.redirect("https://www.creditcanary.co.uk/");
    }
  }

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

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withFrameHeaders(NextResponse.redirect(url), pathname);
  }

  // Bounce a signed-in user off /login → Workflow (the outreach hub).
  if (user && pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/outreach";
    url.search = "";
    return withFrameHeaders(NextResponse.redirect(url), pathname);
  }

  return withFrameHeaders(response, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

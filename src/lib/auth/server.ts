// Server-side Supabase Auth client. Reads + writes the auth-session cookie
// via Next's `cookies()`, so every server component and server action shares
// the same authenticated session.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function authClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const c of toSet) store.set(c.name, c.value, c.options);
          } catch {
            // Server Components can't set cookies — ignored; middleware
            // refreshes the session cookie on every request.
          }
        },
      },
    },
  );
}

export async function currentUser() {
  const supa = await authClient();
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

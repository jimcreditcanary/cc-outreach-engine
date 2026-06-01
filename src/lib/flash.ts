// Server-side flash messages. Server actions call `flash(kind, message)` and
// it sets a short-lived cookie. <FlashToaster /> in the layout reads the
// cookie on navigation and pops a sonner toast, then clears it.
//
//   await flash("success", "Saved");
//   await flash("error", "Couldn't send — invalid email");

import { cookies } from "next/headers";

export type FlashKind = "success" | "error" | "info";

export async function flash(kind: FlashKind, message: string): Promise<void> {
  (await cookies()).set("flash", `${kind}:${message}`, {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
    // not httpOnly — the client reads it once to surface the toast
  });
}

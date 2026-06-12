"use server";

// Public, unauthenticated server action — everything it receives is
// untrusted. createBooking re-validates the slot and the email shape;
// the honeypot field quietly swallows bot submissions with a fake success.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { createBooking } from "@/lib/booking/book";

export async function submitBookingAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").slice(0, 60);
  const slot = String(formData.get("slot") ?? "");
  const embed = String(formData.get("embed") ?? "") === "1" ? "&embed=1" : "";

  // Honeypot — real visitors never see this field.
  if (String(formData.get("website") ?? "") !== "") {
    redirect(`/book/${encodeURIComponent(slug)}?booked=${encodeURIComponent(slot)}${embed}`);
  }

  const res = await createBooking(serviceClient(), {
    slug,
    slotIso: slot,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    company: String(formData.get("company") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  });

  if (!res.ok) {
    redirect(`/book/${encodeURIComponent(slug)}?error=${encodeURIComponent(res.error ?? "Something went wrong — please try again.")}${embed}`);
  }
  const q = new URLSearchParams({ booked: res.start!.toISOString() });
  if (res.joinUrl) q.set("join", res.joinUrl);
  redirect(`/book/${encodeURIComponent(slug)}?${q}${embed}`);
}

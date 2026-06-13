"use server";

// PUBLIC inbound-lead capture (the /enquire landing page). Thin wrapper over
// the shared captureLead pipeline — contact match/create, timeline event,
// /alerts row, owner notification. createCompany is OFF here: anonymous form
// input shouldn't mint companies (the authenticated /api/leads path does,
// since a named company on a gated download is qualified).

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { captureLead } from "@/lib/leads/capture";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function submitEnquiryAction(formData: FormData) {
  const src = String(formData.get("src") ?? "").slice(0, 60);
  const embed = String(formData.get("embed") ?? "") === "1";
  const back = (q: string) =>
    redirect(`/enquire?${q}${src ? `&src=${encodeURIComponent(src)}` : ""}${embed ? "&embed=1" : ""}`);

  // Honeypot — fake success for bots.
  if (String(formData.get("website") ?? "") !== "") back("sent=1");

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!name) back(`error=${encodeURIComponent("Please enter your name.")}`);
  if (!EMAIL_RE.test(email)) back(`error=${encodeURIComponent("That email address doesn't look right.")}`);

  const res = await captureLead(serviceClient(), {
    email,
    name,
    company: String(formData.get("company") ?? "").trim().slice(0, 120) || null,
    message: String(formData.get("message") ?? "").trim().slice(0, 2000) || null,
    source: src || "enquiry-form",
    kind: "enquiry",
    createCompany: false,
  });
  if (!res.ok) back(`error=${encodeURIComponent(res.error ?? "Something went wrong — please try again.")}`);

  back(`sent=1${res.booking_slug ? `&book=${encodeURIComponent(res.booking_slug)}` : ""}`);
}

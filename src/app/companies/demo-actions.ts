"use server";

// Server actions for the demo-link wizard. retrieveBrandingAction profiles a
// site (no save); createDemoAction commits the reviewed branding + mints the
// public slug. Called imperatively from the client wizard (not via <form>).

import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { retrieveBranding } from "@/lib/demos/branding";
import { PRODUCT_TYPES, type Branding } from "@/lib/demos/types";

export async function retrieveBrandingAction(url: string, companyName: string): Promise<{ ok: true; branding: Branding } | { ok: false; error: string }> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!url?.trim()) return { ok: false, error: "Enter the company website first." };
  try {
    const branding = await retrieveBranding(url, companyName || url);
    return { ok: true, branding };
  } catch (e) {
    return { ok: false, error: `Couldn't profile that site: ${(e as Error).message}` };
  }
}

function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "demo";
}

interface CreateDemoInput {
  organisation_id?: string | null;
  company_name: string;
  company_url: string;
  logo_url: string | null;
  bg_color: string;
  tone: string;
  product_type: string;
  description: string;
}

export async function createDemoAction(input: CreateDemoInput): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!input.company_name?.trim()) return { ok: false, error: "Company name is required." };
  const product_type = (PRODUCT_TYPES as readonly string[]).includes(input.product_type) ? input.product_type : PRODUCT_TYPES[0];

  const db = serviceClient();
  // Unique slug: name + short random suffix; retry a couple of times on the
  // (vanishingly unlikely) collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = `${slugify(input.company_name)}-${randomBytes(3).toString("hex")}`;
    const { error } = await db.from("demos").insert({
      slug,
      organisation_id: input.organisation_id ?? null,
      owner_id: me.id,
      company_name: input.company_name.trim(),
      company_url: input.company_url || null,
      logo_url: input.logo_url || null,
      bg_color: input.bg_color || null,
      tone: input.tone || null,
      product_type,
      description: input.description || null,
    });
    if (!error) return { ok: true, slug };
    if (!/duplicate key|unique/i.test(error.message)) {
      const hint = /relation .*demos.* does not exist|column .* does not exist/i.test(error.message) ? " — has migration 038 run?" : "";
      return { ok: false, error: `Couldn't save: ${error.message}${hint}` };
    }
  }
  return { ok: false, error: "Couldn't generate a unique link — try again." };
}

// The per-customer onboarding + billing blocks now live on the company page
// (shown once the company is an Active Customer). This route is kept only so
// older /customers/[id] links don't 404 — it redirects to the company page.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/companies/${id}`);
}

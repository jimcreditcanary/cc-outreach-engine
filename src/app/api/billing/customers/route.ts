// GET /api/billing/customers — the customer directory for veepveep's platform.
// Lists every billing account with the id(s) usable as `client_ref`, its status
// and contract window, and the products it is configured for (so the caller
// knows which item_type keys to feed usage for — only `variable` ones need it).
// Pairs with POST /api/billing/usage/internal. Auth: CRON_SECRET bearer.

import { serviceClient } from "@/lib/db/client";
import { listBillingAccounts, listBillingItems, currentPricingByItemType } from "@/lib/billing/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  const [accounts, pricing] = await Promise.all([listBillingAccounts(db), currentPricingByItemType(db)]);

  // Company names from the nightly HubSpot mirror (one query, no per-account CRM calls).
  const companyIds = [...new Set(accounts.map((a) => a.hubspot_company_id).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (companyIds.length) {
    const { data } = await db.from("hs_mirror_companies").select("id, name").in("id", companyIds);
    for (const r of (data ?? []) as { id: string; name: string | null }[]) if (r.name) names.set(r.id, r.name);
  }

  const customers = await Promise.all(accounts.map(async (a) => {
    const items = (await listBillingItems(db, a.id)).filter((it) => it.active);
    const products = items.map((it) => {
      const t = pricing.get(it.item_type);
      return {
        item_type: it.item_type,
        label: t?.name ?? it.item_type,
        metric: t?.metric ?? null,
        variable: (t?.product_type ?? "variable") === "variable",
        included: (it.config as { included?: boolean } | null)?.included === true,
      };
    });
    return {
      account_id: a.id,
      status: a.status,
      company_name: a.hubspot_company_id ? names.get(a.hubspot_company_id) ?? null : null,
      hubspot_company_id: a.hubspot_company_id,
      onboarding_case_id: a.onboarding_case_id,
      contract_start_date: a.contract_start_date,
      contract_end_date: a.contract_end_date,
      products,
    };
  }));

  return Response.json({ ok: true, count: customers.length, customers });
}

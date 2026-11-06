// GET /api/cron/billing-reconcile — daily scan (CRON_SECRET-guarded). Two jobs:
//  1. provision: create a billing_account for any onboarded case that doesn't
//     have one (self-heals a failed inline create on approval);
//  2. invoice-status-sync (X3): pull Xero status + amount-due for open invoices
//     so the billing list and the 15th chase read current figures.
// `?dry=1` runs both read-only.

import { serviceClient } from "@/lib/db/client";
import { reconcileBilling } from "@/lib/billing/provision";
import { syncInvoiceStatus } from "@/lib/billing/dunning";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const db = serviceClient();
  const provision = dryRun ? { created: 0, dry_run: true } : await reconcileBilling(db);
  const status_sync = await syncInvoiceStatus(db, { dryRun });
  return Response.json({ ok: true, provision, status_sync });
}

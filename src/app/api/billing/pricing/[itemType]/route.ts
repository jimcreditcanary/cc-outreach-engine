// GET /api/billing/pricing/{item_type} — the current effective pricing table +
// bands for an item type. Internal; CRON_SECRET bearer. See /docs/billing-api.md.

import { serviceClient } from "@/lib/db/client";
import { currentPricingByItemType, listBands } from "@/lib/billing/repo";
import { isItemType } from "@/lib/billing/catalogue";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ itemType: string }> }): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { itemType } = await params;
  if (!isItemType(itemType)) return Response.json({ ok: false, error: "unknown item_type" }, { status: 404 });

  const db = serviceClient();
  const table = (await currentPricingByItemType(db)).get(itemType);
  if (!table) return Response.json({ ok: false, error: "no effective pricing table" }, { status: 404 });
  const bands = await listBands(db, table.id);
  return Response.json({ ok: true, item_type: itemType, table, bands });
}

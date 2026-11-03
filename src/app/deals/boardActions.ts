"use server";

// Refresh the HubSpot-backed deals board: drop the short-lived HubSpot read
// cache and re-render the current board. The form posts to this action and the
// page re-renders at the same URL, so pipeline/owner/search filters are kept.

import { revalidatePath } from "next/cache";
import { invalidateCache } from "@/lib/hubspot/client";

export async function refreshDealsAction() {
  invalidateCache();
  revalidatePath("/deals");
}

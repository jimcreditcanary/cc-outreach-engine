// GET /share/<token>/thumb/<uploadId>?t=<accessToken> — a KYC image thumbnail
// for the third-party read-only view. Gated by a valid, non-expired share access
// grant (not a login); scoped to the share's case so it can't read other files.
// Serves a downscaled, inline thumbnail (no full-resolution download).

import { serviceClient } from "@/lib/db/client";
import { validateAccess } from "@/lib/onboarding/shares";
import { downloadUpload } from "@/lib/onboarding/uploads";
import { thumbnailImage } from "@/lib/onboarding/imaging";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ token: string; uploadId: string }> }): Promise<Response> {
  const { token, uploadId } = await params;
  const accessToken = new URL(req.url).searchParams.get("t")?.trim() ?? "";
  const db = serviceClient();

  const res = accessToken ? await validateAccess(db, token, accessToken) : { ok: false as const, reason: "invalid" as const };
  if (!res.ok) return new Response("Forbidden", { status: 403 });

  const file = await downloadUpload(db, res.caseId, uploadId);
  if (!file) return new Response("Not found", { status: 404 });

  const thumb = await thumbnailImage(file.bytes, file.contentType, 520);
  if (!thumb) return new Response("Unsupported", { status: 415 });

  return new Response(new Uint8Array(thumb.data), {
    headers: { "content-type": thumb.contentType, "content-disposition": "inline", "cache-control": "private, no-store" },
  });
}

// GET /onboarding/[id]/thumb/[uploadId] — a staff-only, inline thumbnail of a
// KYC image upload (passport / proof of address). Deliberately NOT a download:
// it serves a downscaled, re-encoded thumbnail with an inline disposition and
// no-store caching, so the full-resolution original is never handed out here —
// the originals live only inside the generated Due Diligence pack. Scoped to the
// case so a token can't be used to read another case's files.

import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { downloadUpload } from "@/lib/onboarding/uploads";
import { thumbnailImage } from "@/lib/onboarding/imaging";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; uploadId: string }> }): Promise<Response> {
  const me = await currentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id, uploadId } = await params;

  const file = await downloadUpload(serviceClient(), id, uploadId);
  if (!file) return new Response("Not found", { status: 404 });

  const thumb = await thumbnailImage(file.bytes, file.contentType, 520);
  if (!thumb) return new Response("Unsupported", { status: 415 });

  return new Response(new Uint8Array(thumb.data), {
    headers: {
      "content-type": thumb.contentType,
      "content-disposition": "inline",
      "cache-control": "private, no-store",
    },
  });
}

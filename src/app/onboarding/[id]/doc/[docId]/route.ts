// GET /onboarding/[id]/doc/[docId] — download a generated onboarding document.
// Authed (middleware gates /onboarding; we also check the session here). Streams
// the file from the private bucket as an attachment.

import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { downloadGeneratedDoc } from "@/lib/onboarding/docgen";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }): Promise<Response> {
  const me = await currentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { docId } = await params;

  const doc = await downloadGeneratedDoc(serviceClient(), docId);
  if (!doc) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      "content-type": doc.contentType,
      "content-disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
    },
  });
}

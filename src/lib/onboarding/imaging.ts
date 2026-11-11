// Image helpers for the Due Diligence pack + portal thumbnails.
//  • PDF → PNG page images via mupdf (wasm — no native deps, serverless-safe),
//    so Companies House filing PDFs (incorporation, accounts) and PDF-format ID
//    uploads can be embedded as pictures in the .docx.
//  • Raster normalisation / downscaling via sharp (already a dep), so merchant
//    photo uploads embed at a sane size and EXIF rotation is honoured.
// Everything is best-effort: a failure returns null/empty rather than throwing
// into document generation.

import sharp from "sharp";

export interface PreparedImage {
  data: Buffer;
  type: "png" | "jpg";
  width: number;
  height: number;
}

/** Render a PDF's pages to PNG images (capped). mupdf is loaded lazily so the
 *  wasm module only initialises when a PDF actually needs rendering. */
export async function pdfToImages(
  pdf: Buffer,
  opts: { scale?: number; maxPages?: number } = {},
): Promise<PreparedImage[]> {
  const { scale = 1.5, maxPages = 8 } = opts;
  try {
    const mupdf = (await import("mupdf")) as unknown as {
      Document: { openDocument(b: Buffer, mime: string): { countPages(): number; loadPage(i: number): { toPixmap(m: unknown, cs: unknown, alpha: boolean): { asPNG(): Uint8Array; getWidth(): number; getHeight(): number } } } };
      Matrix: { scale(x: number, y: number): unknown };
      ColorSpace: { DeviceRGB: unknown };
    };
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    const n = doc.countPages();
    const out: PreparedImage[] = [];
    for (let i = 0; i < Math.min(n, maxPages); i++) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
      out.push({ data: Buffer.from(pix.asPNG()), type: "png", width: pix.getWidth(), height: pix.getHeight() });
    }
    return out;
  } catch {
    return [];
  }
}

/** How many pages a PDF has (0 on failure) — for a "+N more pages" note. */
export async function pdfPageCount(pdf: Buffer): Promise<number> {
  try {
    const mupdf = (await import("mupdf")) as unknown as { Document: { openDocument(b: Buffer, mime: string): { countPages(): number } } };
    return mupdf.Document.openDocument(pdf, "application/pdf").countPages();
  } catch {
    return 0;
  }
}

/** Normalise an uploaded document to a single embeddable image. Raster images are
 *  downscaled + EXIF-rotated; a PDF upload renders its first page. Null if it
 *  can't be prepared (e.g. an unsupported format). */
export async function prepareEmbeddableImage(
  bytes: Buffer,
  contentType: string | null,
  opts: { maxWidth?: number } = {},
): Promise<PreparedImage | null> {
  const { maxWidth = 1100 } = opts;
  try {
    if ((contentType ?? "").toLowerCase().includes("pdf")) {
      const pages = await pdfToImages(bytes, { maxPages: 1, scale: 2 });
      return pages[0] ?? null;
    }
    const buf = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    const meta = await sharp(buf).metadata();
    return { data: buf, type: "jpg", width: meta.width ?? maxWidth, height: meta.height ?? maxWidth };
  } catch {
    return null;
  }
}

/** A small thumbnail for the staff portal — served inline, never offered as a
 *  full-resolution download. PDFs render their first page. */
export async function thumbnailImage(
  bytes: Buffer,
  contentType: string | null,
  maxWidth = 520,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    if ((contentType ?? "").toLowerCase().includes("pdf")) {
      const pages = await pdfToImages(bytes, { maxPages: 1, scale: 1 });
      if (!pages[0]) return null;
      const png = await sharp(pages[0].data).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
      return { data: png, contentType: "image/png" };
    }
    const jpg = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 62 }).toBuffer();
    return { data: jpg, contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

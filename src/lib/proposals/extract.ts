// Proposal ingestion: take an uploaded file, pull raw text out of it
// (pdf / docx / txt / md), then have Claude render it as clean, faithful
// Markdown for storage on the deal (feeds T1 + MEDDICC seeding).
//
// PDF: uses `unpdf` — a serverless-native fork of pdfjs that works in
// Vercel/edge Node runtimes (the original pdf-parse + pdfjs-dist crashes
// on `DOMMatrix is not defined`).
// DOCX: mammoth.
// Heavy deps loaded lazily inside the functions so this module stays
// import-safe for the rest of the RSC bundle.

import { generateText } from "../ai/claude";

export const SUPPORTED = ["pdf", "docx", "txt", "md"] as const;

/** Pull plain text out of a proposal file by extension. */
export async function extractRawText(buf: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt" || ext === "md") return buf.toString("utf8");
  if (ext === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text);
  }
  throw new Error(`Unsupported file .${ext} — use ${SUPPORTED.join(", ")}`);
}

/** Render raw proposal text as faithful Markdown (no summarising). */
export async function toMarkdown(raw: string, hint: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("No text could be extracted from the file");
  return generateText({
    system:
      "You convert raw proposal text into clean, faithful GitHub-flavoured Markdown. " +
      "Preserve ALL content, figures, pricing, dates and structure. Use headings, " +
      "lists and tables where they fit. Do NOT summarise, invent, or omit anything. " +
      "Fix obvious extraction artefacts (broken line-wraps, stray hyphens). " +
      "Output ONLY the markdown — no preamble.",
    user: `Source file: ${hint}\n\nRaw extracted text:\n\n${trimmed.slice(0, 80000)}`,
    cacheSystem: false,
    effort: "low",
    maxTokens: 8000,
  });
}

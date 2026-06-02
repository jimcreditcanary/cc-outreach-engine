// Postmark Sender Signature API.
//
// A "sender signature" is Postmark's per-email-address verification record.
// Every From address has to be either a verified signature OR live on a
// DKIM-confirmed domain — otherwise sends 422 with "you don't own that
// sender". When a new operator joins and sets their own from_email under
// /settings, we automatically register a signature so they don't have to
// log into Postmark themselves.
//
// Requires POSTMARK_ACCOUNT_TOKEN (Account-level token, distinct from the
// server token used to send mail). Get it at:
//   https://account.postmarkapp.com/account/edit → API Tokens

const POSTMARK_API = "https://api.postmarkapp.com";

export interface PostmarkSenderSignature {
  ID: number;
  EmailAddress: string;
  Name?: string;
  ReplyToEmailAddress?: string | null;
  Confirmed: boolean;
  ConfirmationPersonalNote?: string | null;
}

interface PostmarkErrorBody {
  ErrorCode?: number;
  Message?: string;
}

class PostmarkApiError extends Error {
  constructor(public status: number, public body: PostmarkErrorBody | string) {
    super(typeof body === "string" ? body : body.Message ?? `Postmark ${status}`);
  }
}

function accountToken(): string {
  const t = process.env.POSTMARK_ACCOUNT_TOKEN;
  if (!t) throw new Error("Missing POSTMARK_ACCOUNT_TOKEN env var. Get one from Postmark → Account → API Tokens.");
  return t;
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${POSTMARK_API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Account-Token": accountToken(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new PostmarkApiError(res.status, parsed as PostmarkErrorBody | string);
  return parsed as T;
}

/** Parse "Display Name <email@host>" → { name, email }. Accepts a bare email too. */
export function parseRfcAddress(rfc: string): { name: string; email: string } {
  const trimmed = rfc.trim();
  const m = trimmed.match(/^([^<]+)<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() ?? "", email: (m[2] ?? "").trim() };
  // bare email
  const at = trimmed.lastIndexOf("@");
  const localPart = at > 0 ? trimmed.slice(0, at) : trimmed;
  return { name: localPart, email: trimmed };
}

/** Find an existing signature for `email` (case-insensitive). Returns null
 *  if the operator already created one manually before we wired the API. */
export async function findSenderSignatureByEmail(email: string): Promise<PostmarkSenderSignature | null> {
  const wanted = email.toLowerCase();
  // Paginate — Postmark returns 50/page by default; ask for the max (500).
  const body = await call<{ SenderSignatures: PostmarkSenderSignature[]; TotalCount: number }>(
    "GET",
    "/senders?count=500&offset=0",
  );
  return body.SenderSignatures.find((s) => s.EmailAddress.toLowerCase() === wanted) ?? null;
}

/** Create a new sender signature. Postmark fires a confirmation email to
 *  the address; the signature won't be usable until the operator clicks it. */
export async function createSenderSignature(opts: { fromEmail: string; replyTo?: string | null }): Promise<PostmarkSenderSignature> {
  const { name, email } = parseRfcAddress(opts.fromEmail);
  const replyParsed = opts.replyTo ? parseRfcAddress(opts.replyTo).email : undefined;
  return call<PostmarkSenderSignature>("POST", "/senders", {
    FromEmail: email,
    Name: name || email.split("@")[0],
    ReplyToEmail: replyParsed,
    ConfirmationPersonalNote: "Created automatically by the Credit Canary outreach app.",
  });
}

/** Pull the current state of one signature (Confirmed may flip true after
 *  the operator clicks the email). */
export async function getSenderSignature(id: number): Promise<PostmarkSenderSignature> {
  return call<PostmarkSenderSignature>("GET", `/senders/${id}`);
}

/** Re-send the confirmation email. Use if the original got lost. */
export async function resendSenderConfirmation(id: number): Promise<void> {
  await call<unknown>("POST", `/senders/${id}/resend`, {});
}

/** Ensure a verified signature exists for the given address. Returns the
 *  signature (existing or newly created) — calling code stores ID + status
 *  on user_settings. */
export async function ensureSenderSignature(opts: {
  fromEmail: string;
  replyTo?: string | null;
}): Promise<PostmarkSenderSignature> {
  const { email } = parseRfcAddress(opts.fromEmail);
  const existing = await findSenderSignatureByEmail(email);
  if (existing) return existing;
  return createSenderSignature(opts);
}

export { PostmarkApiError };

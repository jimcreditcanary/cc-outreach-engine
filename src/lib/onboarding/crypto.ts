// Field-level encryption for onboarding PII that must not sit in the clear —
// bank sort codes + account numbers (§ non-negotiable: account numbers encrypted
// at rest). AES-256-GCM (authenticated) via node crypto. The key comes from
// ENCRYPTION_KEY: 32 bytes as hex (64 chars) or base64. Generate one with
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Stored format: "<iv b64>:<authTag b64>:<ciphertext b64>". No key → encrypt
// throws (we never fall back to plaintext); callers surface a clear error.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

export function encryptionConfigured(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}

function key(): Buffer {
  const raw = (process.env.ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new Error("ENCRYPTION_KEY is not set — can't store bank details securely.");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes (hex or base64).");
  return buf;
}

/** Encrypt a field. Empty input → empty output (nothing to protect). */
export function encryptField(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a field produced by encryptField. Empty/garbled → empty string. */
export function decryptField(stored: string): string {
  if (!stored) return "";
  const parts = stored.split(":");
  if (parts.length !== 3) return "";
  const [ivB, tagB, dataB] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB!, "base64"));
    decipher.setAuthTag(Buffer.from(tagB!, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB!, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** Last 4 digits for safe display without decrypting the whole number elsewhere. */
export function maskTail(plaintext: string): string {
  const d = plaintext.replace(/\s+/g, "");
  return d.length <= 4 ? d : `••••${d.slice(-4)}`;
}

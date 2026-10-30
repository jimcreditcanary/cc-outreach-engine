// Per-item usage API keys. The plaintext is shown to the operator ONCE at
// activation; only the SHA-256 hash is stored (usage_api_key_hash). The Phase-3
// usage endpoint hashes the presented bearer and matches it against the stored
// hash.

import { createHash, randomBytes } from "crypto";

export function hashUsageKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Generate a new usage key + its hash. Key format: `ccb_<48 hex>`. */
export function generateUsageKey(): { key: string; hash: string } {
  const key = `ccb_${randomBytes(24).toString("hex")}`;
  return { key, hash: hashUsageKey(key) };
}

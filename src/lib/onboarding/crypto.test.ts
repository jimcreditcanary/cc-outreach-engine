import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { encryptField, decryptField, maskTail, encryptionConfigured } from "./crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

describe("onboarding field crypto", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const plain = "12345678";
    const enc = encryptField(plain);
    expect(enc).not.toContain(plain);
    expect(enc.split(":")).toHaveLength(3);
    expect(decryptField(enc)).toBe(plain);
  });

  it("gives different ciphertext each time (random IV)", () => {
    expect(encryptField("20-00-00")).not.toBe(encryptField("20-00-00"));
  });

  it("empty in → empty out", () => {
    expect(encryptField("")).toBe("");
    expect(decryptField("")).toBe("");
  });

  it("returns empty on a tampered/garbled ciphertext (auth fails)", () => {
    const enc = encryptField("87654321");
    const tampered = enc.slice(0, -2) + (enc.endsWith("AA") ? "BB" : "AA");
    expect(decryptField(tampered)).toBe("");
    expect(decryptField("not-a-ciphertext")).toBe("");
  });

  it("masks to the last four", () => {
    expect(maskTail("12345678")).toBe("••••5678");
    expect(maskTail("123")).toBe("123");
  });

  it("reports configured when the key is set", () => {
    expect(encryptionConfigured()).toBe(true);
  });
});

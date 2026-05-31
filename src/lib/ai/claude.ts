// Thin Anthropic wrapper for the outreach engine.
//
// One client, one place to set the model + effort, and two call shapes:
//   - generateStructured: strict JSON validated against a Zod schema
//     (messages.parse + zodOutputFormat). Used for tagging, MEDDICC, etc.
//   - generateText: a prose artifact (used for the voice spec).
//
// The large shared prompt (targeting map / voice spec / vocabulary) goes in
// `system` as a cache_control:ephemeral block so it's cached across the many
// per-item calls (build brief §7 — Anthropic for generation). Per-item
// volatile content goes in the user message, after the cached prefix.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY in env");
    }
    _client = new Anthropic();
  }
  return _client;
}

/** Opus 4.7 is the default; override per-deployment via ANTHROPIC_MODEL.
 *  Uses `||` (not `??`) so an empty-string env var — which happens when a
 *  GitHub Actions secret is referenced but not set — still falls back. */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-7";

export type Effort = "low" | "medium" | "high" | "max";

interface CommonOpts {
  /** Large, stable prompt — cached as an ephemeral system block. */
  system: string;
  /** Per-call volatile content. */
  user: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  /** Cache the system prefix (default true). */
  cacheSystem?: boolean;
}

function systemParam(system: string, cache: boolean) {
  return cache
    ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
    : system;
}

/**
 * Strict structured output. Returns the Zod-validated object, or throws on
 * refusal / empty output.
 */
export async function generateStructured<T extends z.ZodType>(
  opts: CommonOpts & { schema: T },
): Promise<z.infer<T>> {
  const { system, user, schema, model = DEFAULT_MODEL, effort = "low", maxTokens = 4000, cacheSystem = true } = opts;

  const res = await client().messages.parse({
    model,
    max_tokens: maxTokens,
    system: systemParam(system, cacheSystem),
    output_config: { format: zodOutputFormat(schema), effort },
    messages: [{ role: "user", content: user }],
  });

  if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
  if (res.parsed_output == null) {
    throw new Error(`No parsed output (stop_reason=${res.stop_reason})`);
  }
  return res.parsed_output;
}

/** Plain text generation. Returns the concatenated text blocks. */
export async function generateText(opts: CommonOpts): Promise<string> {
  const { system, user, model = DEFAULT_MODEL, effort = "medium", maxTokens = 8000, cacheSystem = true } = opts;

  const res = await client().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemParam(system, cacheSystem),
    output_config: { effort },
    messages: [{ role: "user", content: user }],
  });

  if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

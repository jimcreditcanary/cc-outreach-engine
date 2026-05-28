import type { NextConfig } from "next";
import { config } from "dotenv";

// Force .env.local values to win over the shell. Without this, an empty
// ANTHROPIC_API_KEY exported in the shell beats the real one in .env.local
// (Next gives shell env priority), so server actions crash with
// "Missing ANTHROPIC_API_KEY". Safe in dev; on Vercel there's no .env.local.
config({ path: ".env.local", override: true });

const nextConfig: NextConfig = {
  // pdf-parse and mammoth do native-ish work at module load (pdf-parse pokes
  // `Object.defineProperty` on things webpack mangles in the RSC bundle and
  // dies with "Object.defineProperty called on non-object"). Marking them
  // external tells Next to load them as regular Node deps at runtime rather
  // than try to bundle them.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;

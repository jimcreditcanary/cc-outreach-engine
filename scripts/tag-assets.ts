// AI asset tagging (build brief step 2b).
//
//   npm run tag-assets
//
// Classifies each content_asset against a CONTROLLED vocabulary — the problem
// lanes (targeting map §4) and the sector enum — returning strict JSON. The
// vocabulary lives in the cached system prompt; the per-asset text is the
// volatile user message. Deterministic sector tags from the crawler are
// preserved (unioned), never overwritten.

import { config } from "dotenv";
import { z } from "zod";
import { serviceClient } from "../src/lib/db/client";
import { generateStructured } from "../src/lib/ai/claude";

config({ path: ".env.local", override: true });

const PROBLEM_LANES = [
  "affordability_analysis",
  "income_identification",
  "complex_case_decisioning",
  "smart_origination",
  "straight_through_processing",
  "collections_optimisation",
  "payments_automation",
] as const;

const SECTORS = [
  "bank",
  "broker",
  "building_society",
  "credit_union",
  "direct_lender",
  "marketplace",
  "sme_lender",
  "utility",
] as const;

const TagResult = z.object({
  tags_problem: z.array(z.enum(PROBLEM_LANES)),
  tags_sector: z.array(z.enum(SECTORS)),
});

const SYSTEM = `You tag Credit Canary website content for an outreach engine.
Given one page, return the problem lanes and sectors it is RELEVANT to — only
strong matches, not loose ones. Empty arrays are fine for generic/marketing pages.

PROBLEM LANES (use these exact tokens):
- affordability_analysis — affordability assessment, expenditure categorisation, SFS
- income_identification — verifying/identifying income, payslip/Open Banking income
- complex_case_decisioning — edge-case referral, human-in-the-loop, 360° case view
- smart_origination — application journeys, conversion, onboarding, pre-qualification
- straight_through_processing — end-to-end automation, decision-to-disbursement
- collections_optimisation — arrears, missed payments, pre-arrears, recovery
- payments_automation — payment rails, Direct Debit, Pay by Bank, reconciliation

SECTORS (use these exact tokens): bank, broker, building_society, credit_union,
direct_lender, marketplace, sme_lender, utility.

Only tag a sector if the page is specifically about/for that sector.`;

async function main() {
  const db = serviceClient();
  const { data, error } = await db
    .from("content_assets")
    .select("id, url, title, type, description, body_text, tags_sector")
    .not("body_text", "is", null);
  if (error) throw error;

  const assets = data ?? [];
  console.log(`Tagging ${assets.length} assets…`);
  let n = 0;

  for (const a of assets) {
    const user = [
      `URL: ${a.url}`,
      `Type: ${a.type ?? "(none)"}`,
      `Title: ${a.title ?? ""}`,
      `Description: ${a.description ?? ""}`,
      `Body:\n${(a.body_text ?? "").slice(0, 3500)}`,
    ].join("\n");

    const result = await generateStructured({
      system: SYSTEM,
      user,
      schema: TagResult,
    });

    // Preserve deterministic crawler sector tags; union with the model's.
    const sectors = Array.from(new Set([...(a.tags_sector ?? []), ...result.tags_sector]));

    const { error: upErr } = await db
      .from("content_assets")
      .update({ tags_problem: result.tags_problem, tags_sector: sectors })
      .eq("id", a.id);
    if (upErr) throw upErr;

    n++;
    console.log(`  [${n}/${assets.length}] ${a.url} → problems=[${result.tags_problem.join(",")}] sectors=[${sectors.join(",")}]`);
  }

  console.log(`Tagged ${n} assets.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

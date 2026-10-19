// Per-contact research/curation — the "we've done our homework" layer. Runs a
// few SERP queries (company news + the person) and has Claude synthesise a
// tight, FACTUAL brief (recent signals, named people, a problem statement),
// stored on the HubSpot contact's Context field for the drafter to use.
// Strictly grounded: only facts present in the search results, never invented.

import { z } from "zod";
import { serpSearch, serpEnabled } from "../search/serp";
import { generateStructured } from "../ai/claude";

export { serpEnabled };

export interface ResearchInput {
  full_name: string | null;
  job_title: string | null;
  company_name: string | null;
  domain?: string | null;
  industry?: string | null;
}

export interface ResearchResult {
  context_md: string;
  problem_statement: string | null;
  confidence: "high" | "medium" | "low";
  sources: string[];
}

const schema = z.object({
  context_md: z.string().describe("A concise markdown brief: what the company does, recent relevant signals (with the specific detail + any named people), and how they bear on lending/credit/origination. Only facts from the results — never invented. A few bullets."),
  problem_statement: z.string().nullable().describe("One line: the likely problem Credit Canary could help with, grounded in the signals. Null if nothing credible."),
  confidence: z.enum(["high", "medium", "low"]).describe("How much real, specific signal the results gave."),
});

const SYSTEM = `You are a B2B sales researcher for Credit Canary (UK credit decisioning, affordability and origination for lenders). From the SEARCH RESULTS, write a short, factual research brief to personalise outreach.

STRICT RULES
- Use ONLY facts present in the search results. Attribute nothing you cannot see. If a detail isn't there, leave it out — do not guess or generalise into invention.
- Prefer recent, specific signals: launches, funding, hires, strategy shifts, regulatory moves, partnerships, named people and their roles.
- Keep it tight — a few bullets. No marketing fluff, no restating the obvious.
- If the results are thin, say so plainly and keep the brief minimal (confidence: low).`;

export async function researchContact(input: ResearchInput): Promise<ResearchResult> {
  const company = (input.company_name ?? "").trim();
  const name = (input.full_name ?? "").trim();

  const queries: string[] = [];
  if (company) {
    queries.push(`${company} news`);
    queries.push(`${company} lending OR credit OR launch OR partnership OR funding OR regulation`);
  }
  if (name && company) queries.push(`"${name}" ${company}`);
  if (input.domain) queries.push(`site:${input.domain} press OR news OR blog`);

  const sources: string[] = [];
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const q of queries) {
    try {
      const results = (await serpSearch(q)).slice(0, 5);
      blocks.push(`# query: ${q}`);
      for (const r of results) {
        blocks.push(`- ${r.title} — ${r.link}\n  ${r.snippet ?? ""}`);
        if (!seen.has(r.link)) { seen.add(r.link); sources.push(r.link); }
      }
    } catch { /* skip a failed query, keep going */ }
  }

  const user = [
    `Prospect: ${name || "(unknown)"} — ${input.job_title ?? "?"} at ${company || "(unknown)"} (${input.industry ?? "?"}).`,
    "",
    "SEARCH RESULTS:",
    blocks.length ? blocks.join("\n") : "(no results)",
  ].join("\n");

  const out = await generateStructured({ system: SYSTEM, user, schema, effort: "medium", maxTokens: 1200 });
  return { ...out, sources };
}

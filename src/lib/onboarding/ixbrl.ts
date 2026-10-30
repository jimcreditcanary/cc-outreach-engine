// Phase 2b — pragmatic iXBRL accounts extractor. iXBRL is XHTML with inline
// XBRL facts (<ix:nonFraction name="…" contextRef="…" scale="…" sign="…">…</ix…>).
// A full XBRL processor is taxonomy-aware and huge; this extracts the handful of
// headline figures (turnover, profit/loss, net assets, cash, employees) for the
// LATEST reported period by:
//   1. reading each context's period end-date,
//   2. reading each numeric fact (value × 10^scale, negated if sign="-"),
//   3. picking, per concept (matched on the local name), the fact whose context
//      is the latest period.
// Best-effort + advisory — the raw facts are kept so nothing is lost. Pure, so
// it's unit-tested against a fixture.

export interface IxbrlFact { name: string; local: string; value: number; contextRef: string; periodEnd: string | null }

export interface ParsedAccounts {
  periodEnd: string | null;
  turnover: number | null;
  profit_loss: number | null;
  net_assets: number | null;
  cash: number | null;
  employees: number | null;
  facts: { name: string; value: number; periodEnd: string | null }[];
}

const tag = (p: string) => `(?:[\\w]+:)?${p}`; // optional namespace prefix

/** contextId → period end date (end-date, else instant). */
function parseContexts(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const ctxRe = new RegExp(`<${tag("context")}\\s+id="([^"]+)"([\\s\\S]*?)<\\/${tag("context")}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = ctxRe.exec(xml))) {
    const id = m[1]!;
    const body = m[2]!;
    const end = body.match(new RegExp(`<${tag("enddate")}>\\s*([\\d-]+)`, "i")) || body.match(new RegExp(`<${tag("instant")}>\\s*([\\d-]+)`, "i"));
    if (end) out.set(id, end[1]!.trim());
  }
  return out;
}

function toNumber(text: string): number | null {
  const cleaned = text.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function attr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1]! : "";
}

function parseFacts(xml: string, contexts: Map<string, string>): IxbrlFact[] {
  const facts: IxbrlFact[] = [];
  const re = new RegExp(`<ix:nonfraction\\s+([^>]*?)>([\\s\\S]*?)<\\/ix:nonfraction>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1]!;
    const raw = m[2]!;
    const name = attr(attrs, "name");
    if (!name) continue;
    let value = toNumber(raw);
    if (value == null) continue;
    const scale = Number(attr(attrs, "scale") || "0");
    if (Number.isFinite(scale) && scale !== 0) value *= 10 ** scale;
    if (attr(attrs, "sign") === "-") value = -value;
    const contextRef = attr(attrs, "contextref");
    const local = name.includes(":") ? name.split(":").pop()!.toLowerCase() : name.toLowerCase();
    facts.push({ name, local, value, contextRef, periodEnd: contexts.get(contextRef) ?? null });
  }
  return facts;
}

/** Pick the value for a concept (matched by any of `needles` as a substring of
 *  the local name) at the latest period. */
function pick(facts: IxbrlFact[], needles: string[], latest: string | null): number | null {
  const matches = facts.filter((f) => needles.some((n) => f.local.includes(n)));
  if (matches.length === 0) return null;
  const atLatest = latest ? matches.filter((f) => f.periodEnd === latest) : matches;
  const pool = atLatest.length ? atLatest : matches;
  // Prefer an exact local-name match if present, else the first.
  const exact = pool.find((f) => needles.includes(f.local));
  return (exact ?? pool[0]!).value;
}

export function parseIxbrl(xhtml: string): ParsedAccounts {
  const contexts = parseContexts(xhtml);
  const facts = parseFacts(xhtml, contexts);
  const dates = [...contexts.values()].filter(Boolean).sort();
  const latest = dates.length ? dates[dates.length - 1]! : null;

  return {
    periodEnd: latest,
    turnover: pick(facts, ["turnover", "revenue", "turnoverrevenue"], latest),
    profit_loss: pick(facts, ["profitloss"], latest),
    net_assets: pick(facts, ["netassetsliabilities", "netassets", "shareholdersfunds", "equity"], latest),
    cash: pick(facts, ["cashbankonhand", "cashcashequivalents", "cashbank"], latest),
    employees: pick(facts, ["averagenumberemployees"], latest),
    facts: facts.map((f) => ({ name: f.name, value: f.value, periodEnd: f.periodEnd })),
  };
}

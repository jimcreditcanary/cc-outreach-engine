// Data shaping for the printable onboarding review page (the single source of
// truth for a submitted case, replacing the generated Word pack). Server-side,
// doc-free: it only turns the stored answers + CH ownership into display rows.

import type { AnswerMap } from "./formAnswers";
import type { UboRow } from "./enrich";
import { distinctIndividualUbos } from "./enrich";
import { parsePersonName, nameMatchKey } from "./personName";
import {
  INFOSEC_SMALL, INFOSEC_LARGE, POLICY_QUESTIONS,
  PAYMENT_ANSWER_KEYS, INFOSEC_ANSWER_KEYS, COMPANY_FIELDS, SOCIAL_FIELDS,
  productLabel,
} from "../../app/m/[token]/fields";

export interface QA { q: string; a: string; note?: string }

const v = (answers: AnswerMap, k: string) => (answers[k]?.value ?? "").trim();
const titleize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ─── label maps ──────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  pay_take_payments_for: "What payments are taken for",
  pay_bank_statement: "Recent bank statement provided",
  pay_bank_statement_reason: "Reason (if no statement)",
  pay_expected_volume: "Expected monthly volume (count)",
  pay_avg_value: "Average transaction value",
  pay_max_value: "Maximum transaction value",
  pay_b2b_b2c: "Customer base (B2B / B2C)",
  pay_b2b_pct: "B2B %",
  pay_b2c_pct: "B2C %",
  pay_collect_method: "How payments are collected / provider",
};
const DD_LABELS: Record<string, string> = {
  dd_has_sun: "Has an active SUN",
  dd_sun_number: "SUN",
  dd_sun_provider: "SUN provider",
  dd_branded_sun_ok: "Branded SUN acceptable",
  dd_statement_display: "Statement display name",
  dd_transfer: "Direct Debit transfer",
  dd_max_collection_limit: "Max collection per customer / month",
  dd_frequency: "Collection frequency",
  dd_frequency_other: "Frequency (other)",
  dd_frequency_split: "Frequency split",
  dd_before_after: "Collect before / after service",
  dd_schedule: "Schedule type",
  dd_collection_dates: "Collection date(s)",
  dd_advance_notice: "Advance-notice method",
  dd_auto_represent: "Auto-representment",
  dd_gift_aid: "Gift Aid",
  dd_signup: "Sign-up method",
};
const INFOSEC_TOP_LABELS: Record<string, string> = {
  infosec_cmc_pi: "A Claims Management / Personal Injury firm?",
  infosec_search_type_ok: "Search type in keeping with the business?",
  infosec_shared_email: "Uses a shared email account?",
  infosec_ico_notice: "Subject to an ICO enforcement / decision notice?",
  infosec_data_transfer: "Transfers data outside the UK / EEA?",
  infosec_industry_body: "Industry-body membership required?",
  infosec_membership_valid: "Membership valid & current?",
  infosec_iso27001: "ISO 27001 certified?",
  infosec_pci: "PCI DSS certified?",
  infosec_soc2: "SOC 2 certified?",
  infosec_iso27001_intending: "Intending to certify ISO 27001?",
  infosec_align_other: "Other security arrangements in place?",
  infosec_over_10: "More than 10 employees?",
};

// ─── Q&A builders (only answered rows) ───────────────────────────────────────

const rows = (answers: AnswerMap, labels: Record<string, string>): QA[] =>
  Object.entries(labels).map(([k, q]) => ({ q, a: v(answers, k) })).filter((r) => r.a);

export function paymentQA(answers: AnswerMap): QA[] {
  const reasons = Object.keys(answers)
    .filter((k) => k.startsWith("reason_"))
    .map((k) => ({ q: `Reason for ${productLabel(k.replace(/^reason_/, ""))}`, a: v(answers, k) }))
    .filter((r) => r.a);
  return [...rows(answers, PAYMENT_LABELS), ...reasons];
}
export function ddQA(answers: AnswerMap): QA[] {
  return rows(answers, DD_LABELS);
}
export function infosecQA(answers: AnswerMap): { top: QA[]; detail: QA[]; over10: string } {
  const over10 = v(answers, "infosec_over_10");
  const set = over10 === "yes" ? INFOSEC_LARGE : over10 === "no" ? INFOSEC_SMALL : [];
  const detail = (set as ReadonlyArray<readonly [string, string]>)
    .map(([k, label]) => ({ q: label, a: v(answers, k), note: v(answers, `${k}_explain`) || undefined }))
    .filter((r) => r.a);
  return { top: rows(answers, INFOSEC_TOP_LABELS), detail, over10 };
}
export function policyQA(answers: AnswerMap): QA[] {
  return POLICY_QUESTIONS
    .map((p) => ({
      q: p.label,
      a: v(answers, p.key),
      note: v(answers, `${p.key}_detail`) || (v(answers, `${p.key}_later`) === "yes" ? "To be provided later" : undefined),
    }))
    .filter((r) => r.a);
}

/** Any answered field not already shown in a known group — guarantees "all the
 *  Q&A" appears, even keys added to the form later. */
export function otherQA(answers: AnswerMap): QA[] {
  const known = new Set<string>([
    ...COMPANY_FIELDS.map((f) => f.key),
    "trading_address", "signatory_name", "signatory_title", "signatory_email",
    "trade_body", "trade_body_required", "ubo_list_complete",
    ...SOCIAL_FIELDS.map((f) => f.key),
    ...PAYMENT_ANSWER_KEYS, "dd_signup",
    ...INFOSEC_ANSWER_KEYS,
    ...POLICY_QUESTIONS.flatMap((p) => [p.key, `${p.key}_text`, `${p.key}_detail`, `${p.key}_later`]),
  ]);
  return Object.keys(answers)
    .filter((k) => !known.has(k))
    .filter((k) => !/^(_page_|dpo_\d+_|reason_)/.test(k))
    .map((k) => ({ q: titleize(k), a: v(answers, k) }))
    .filter((r) => r.a)
    .sort((a, b) => a.q.localeCompare(b.q));
}

// ─── simple, accurate ownership (no placeholder scaffold) ────────────────────

export interface OwnerLine {
  name: string;
  pct: string;         // declared % from KYC, when given
  natures: string;     // natures of control (most direct node)
  direct: boolean;     // a direct PSC of the operating company
  via: string[];       // holding companies it's held through
}
export interface HoldingLine { name: string; number: string | null; natures: string }
export interface OwnershipView {
  operatingName: string;
  operatingNumber: string | null;
  owners: OwnerLine[];
  holdings: HoldingLine[];
  historic: string[];
}

const natures = (list: string[] | null | undefined): string =>
  (list ?? []).map((n) => n.replace(/-/g, " ").replace(/\bpercent\b/g, "%")).join("; ");

export function ownershipView(
  operatingName: string, operatingNumber: string | null,
  ubos: UboRow[], kyc: { ubo_name: string; exact_ownership_percent?: string | null }[],
): OwnershipView {
  const byId = new Map(ubos.map((u) => [u.id, u]));
  const personKey = (name: string | null | undefined) => {
    const pn = parsePersonName(name ?? "");
    return nameMatchKey(pn.first, pn.last) || (name ?? "").toLowerCase();
  };
  const pctByKey = new Map<string, string>();
  for (const k of kyc) {
    if (k.exact_ownership_percent) pctByKey.set(personKey(k.ubo_name), String(k.exact_ownership_percent));
  }

  const owners: OwnerLine[] = distinctIndividualUbos(ubos).map((owner) => {
    const key = personKey(owner.name);
    // Every node for this same person (across the chain).
    const nodes = ubos.filter((u) => !u.is_corporate && !u.ceased_on && personKey(u.name) === key);
    const direct = nodes.some((n) => !n.parent_id);
    const via = nodes
      .filter((n) => n.parent_id)
      .map((n) => (n.parent_id && byId.get(n.parent_id)?.name) || "")
      .filter(Boolean);
    const pctRaw = pctByKey.get(key);
    return {
      name: owner.name ?? "",
      pct: pctRaw ? `${pctRaw}%` : "",
      natures: natures(owner.natures_of_control),
      direct,
      via: [...new Set(via)],
    };
  });

  const holdings: HoldingLine[] = ubos
    .filter((u) => u.is_corporate && !u.ceased_on && u.name)
    .map((u) => ({ name: u.name!, number: (u.identification?.registration_number as string) ?? u.via_company_number ?? null, natures: natures(u.natures_of_control) }));

  const historic = ubos
    .filter((u) => !u.is_corporate && u.ceased_on && u.name)
    .map((u) => `${u.name} (ceased ${u.ceased_on})`);

  return {
    operatingName,
    operatingNumber,
    owners,
    holdings: dedupeBy(holdings, (h) => `${h.name}|${h.number}`),
    historic: [...new Set(historic)],
  };
}

function dedupeBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((t) => { const k = key(t); if (seen.has(k)) return false; seen.add(k); return true; });
}

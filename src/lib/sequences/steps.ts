// The fixed 13-day outreach cadence every sequence runs.
//
// This is the single source of truth — change here and every running
// sequence picks up the new shape from the next cron tick onward. The cron
// reads SEQUENCE_STEPS, finds each contact's `current_step`, and decides
// whether to create an action row (manual) or queue an AI draft (auto).
//
// kind values are stored in sequence_actions.kind so they're stable —
// don't rename without a migration.

export type StepKind =
  | "view_linkedin"
  | "send_connection"
  | "send_email_initial"
  | "call"
  | "send_email_followup"
  | "linkedin_engage"
  | "send_email_case"
  | "send_email_breakup";

export interface Step {
  /** 1-indexed offset in DAYS from the sequence-contact's start_at. */
  day: number;
  kind: StepKind;
  /** True for steps the system can perform on the operator's behalf
   *  (currently: email steps auto-generate a queued draft). False for
   *  steps the operator must do manually (view profile, call, like a post). */
  auto: boolean;
  /** Short label shown in the action list. */
  label: string;
  /** Longer description / coaching note shown when an action is opened. */
  notes?: string;
}

export const SEQUENCE_STEPS: Step[] = [
  { day: 1,  kind: "view_linkedin",       auto: false, label: "View their LinkedIn profile",
    notes: "Skim recent activity for a hook before sending the connection request." },
  { day: 1,  kind: "send_connection",     auto: false, label: "Send LinkedIn connection request",
    notes: "Personal note tied to something on their profile. No pitch." },
  { day: 1,  kind: "send_email_initial",  auto: true,  label: "Send opener email",
    notes: "Short awareness email — angle to be one of: faster credit decisions, lower manual underwriting, better fraud/risk controls, improved acceptance rates, regulatory/compliance efficiency. Not pitching." },
  { day: 2,  kind: "call",                auto: false, label: "First call attempt",
    notes: "Quick call. If no answer, leave a 20-second voicemail referencing the email." },
  { day: 4,  kind: "send_email_followup", auto: true,  label: "Follow-up insight email",
    notes: "Value-driven, ≤120 words. Industry trend, FCA pressure, BNPL growth, AI underwriting, cost reduction, CX improvement." },
  { day: 6,  kind: "linkedin_engage",     auto: false, label: "Engage on a recent LinkedIn post",
    notes: "Like/comment naturally on something they posted. Goal = familiarity, NO pitch." },
  { day: 8,  kind: "call",                auto: false, label: "Second call attempt",
    notes: "Different opener — e.g. \"a lot of lenders are reviewing automation in underwriting workflows…\" or \"we've seen firms reduce manual review time by X…\"." },
  { day: 10, kind: "send_email_case",     auto: true,  label: "Case-study email",
    notes: "Short client story with metrics + ROI + quick win. e.g. \"reduced decision times by 40%\", \"cut manual referrals by 30%\"." },
  { day: 13, kind: "send_email_breakup",  auto: true,  label: "Breakup email",
    notes: "Low-pressure close-the-loop. Usually re-engages 1 in 5." },
];

/** Total days the cadence spans. Useful for completion logic. */
export const SEQUENCE_TOTAL_DAYS = Math.max(...SEQUENCE_STEPS.map((s) => s.day));

/** Friendly badge colour for each step kind — keep visual consistency
 *  across /sequences detail + /queue annotation. */
export const STEP_BADGE: Record<StepKind, string> = {
  view_linkedin:       "bg-blue-100 text-blue-800",
  send_connection:     "bg-blue-100 text-blue-800",
  linkedin_engage:     "bg-blue-100 text-blue-800",
  call:                "bg-purple-100 text-purple-800",
  send_email_initial:  "bg-amber-100 text-amber-800",
  send_email_followup: "bg-amber-100 text-amber-800",
  send_email_case:     "bg-amber-100 text-amber-800",
  send_email_breakup:  "bg-amber-100 text-amber-800",
};

/** True when this step is an outbound email — the engine queues an AI
 *  draft instead of asking the operator to do something manually. */
export function isEmailStep(s: Step | StepKind): boolean {
  const kind = typeof s === "string" ? s : s.kind;
  return kind.startsWith("send_email_");
}

/** When does step `index` come due for a sequence-contact that started at
 *  `startedAt`? Returns a Date the cron compares against now(). */
export function dueDateFor(startedAt: Date, index: number): Date {
  const step = SEQUENCE_STEPS[index];
  if (!step) return new Date(8.64e15); // far future = never
  return new Date(startedAt.getTime() + (step.day - 1) * 86_400_000);
}

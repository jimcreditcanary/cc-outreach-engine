# Outreach engine — operator runbook

How to drive the Credit Canary outreach engine day to day. The engine runs on
**HubSpot** (contacts/companies/deals) + **Postmark** (sending), with AI drafting
in each rep's voice. Everything is **approval-queue-first** — nothing emails a
prospect until a human approves and hits send.

---

## The daily loop (outbound)

1. **Outreach → Workflow.** Pick a segment (New leads / All with email /
   `source:<x>`), set how many, hit **Draft run**. The engine researches each
   contact, writes their Context, and drafts a personalised email tied to one CC
   page — in your voice. High-confidence drafts auto-approve; the rest queue.
2. **Review.** Read each draft, edit if needed, **Approve** (or Discard).
3. **Send batch.** Sends the approved queue slowly, with all guardrails, and logs
   each as a HubSpot email activity. (Shows a dry-run banner if `POSTMARK_SERVER_TOKEN`
   is unset.)
4. **Inbound is automatic.** Downloads / enquiries / abandonment / bookings
   enqueue a warm, event-aware follow-up draft (cron every 15 min) → it lands in
   the same review queue.
5. **Pounce on intent.** A prospect who clicks a link, or visits the site 2+
   times (GA4), gets a **HubSpot task** auto-created on them — follow up while warm.

Bigger drafting runs than the in-app cap: `npm run workflow -- <segment> --limit=50`.

## The weekly loop (deal nurture)

- **Outreach → Nurture deals** (or `npm run nurture -- --limit=20`). Appraises
  your open deals via MEDDICC and drafts a next-step nudge to each deal's contact.
  Deals you've already contacted this week are skipped. Review + send as above.

## What each rep sets once (Settings)

- **Outreach voice** — your sign-off, closing line, tone, length, subject style.
- **HubSpot owner** — leave blank + Save to auto-detect from your email (or admin
  runs **Sync all users**). Scopes deal-nurture + intent tasks to *your* deals.
- **Sender identity / Postmark signature** — your From / Reply-To.

## Keeping the brains fresh

| What | When | Command |
|---|---|---|
| Website content map (what/who/when) | after site changes | `npm run crawl` → `npm run content-guidance` → `npm run site-markdown` |
| Per-contact research (Context) | before a push (or auto in the workflow) | `npm run enrich-context -- --limit=20` |
| Voice spec (from sent/edited drafts) | periodically | `npm run refresh-voice` |

## Jobs (npm run …)

- `workflow -- <segment>` — outbound: research + draft a segment into the queue
- `nurture` — weekly deal-nurture drafts
- `inbound-followups` — process pending inbound events into drafts (also cron)
- `ga4-intent` — raise high-intent tasks from GA4 visits (also cron)
- `hs-mailer -- list | approve [campaign] | send` — CLI review + send
- `enrich-context` / `content-guidance` / `site-markdown` — the brains above
- `hubspot-setup-props` — (re)create custom HubSpot properties (idempotent)
- `backfill-suppressions` — rebuild suppression list from history (one-off)
- `hubspot-smoke` — sanity-check the HubSpot connection

## Crons (vercel.json)

- `/api/cron/inbound` — every 15 min — draft inbound follow-ups
- `/api/cron/ga4-intent` — hourly — GA4 visits → high-intent tasks
- `/api/cron/granola`, `/sync-calendar`, `/sequences`, `/alerts`, `/daily` — existing
- *(The legacy Supabase mailer crons `generate` / `send` act on the old `sends`
  table and are dormant under the HubSpot engine.)*

## Guardrails (always on)

- **Suppression** (email-keyed): bounces, complaints and opt-outs never get
  re-emailed, from either mailer.
- **Company bounce protection**, **UK business-hours window**, **warm-up ramp +
  daily cap** (`SEND_WARMUP_RAMP`, `SEND_DAILY_CAP`), **auto-pause** on
  complaint/bounce spikes.
- **Anonymisation**: drafts never name a Credit Canary client (hard check).
- **Approval-first**: sending only happens on an explicit Send (no auto-send cron
  for HubSpot sends).

## Go-live checklist

- **Migrations applied** (SQL editor): 034–046.
- **Vercel env**: `HUBSPOT_TOKEN`, `POSTMARK_SERVER_TOKEN`, `SERPER_API_KEY`,
  `ANTHROPIC_API_KEY` (funded), `GA4_PROPERTY_ID`,
  `GOOGLE_APPLICATION_CREDENTIALS_JSON` (base64), `CRON_SECRET`,
  `POSTMARK_INBOUND_WEBHOOK_SECRET`, `LEAD_API_KEY`.
- **Postmark webhooks → prod**: `…/api/postmark/webhook?token=<secret>` and
  `…/api/postmark/inbound?token=<secret>`.
- **Website**: lead forms POST to `/api/leads`; GA4 sends `cc_cid` as a custom
  dimension; abandonment (optional) POSTs `/api/inbound/abandonment`.
- **First send**: start small (a handful, to yourself/a test address) before a
  real segment.

## Where things live

- CRM (contacts/companies/deals): **HubSpot** (portal Fumopay Ltd, 9175484).
- Send log / cadence / queues / suppression: **Supabase** (`hs_sends`,
  `inbound_followups`, `deal_appraisals`, `intent_signals`, `suppressions`).
- Drafter inputs: `creditcanary-site.md` (content map) + `creditcanary-voice-spec.md`
  (voice) + HubSpot contact/company **Context** fields.
- Architecture + field mapping: `docs/HUBSPOT_MIGRATION.md`.

# HubSpot migration — plan & field mapping

Moving the CRM's **system of record** from Supabase to HubSpot. The app keeps
Supabase for operational state and talks to HubSpot for contacts/companies.

## Decisions (locked 2026-10-16)

- **HubSpot = source of truth.** Supabase CRM data (contacts/companies/deals)
  is disposable — **no upward migration**; HubSpot is already current.
- **App ↔ HubSpot = REST API** (`@hubspot/api-client`, Private App token),
  server-side. *Not* MCP — MCP is for agentic/Claude-side work only.
- **Reads: live + short-TTL cache now; webhook-synced mirror later** (see the
  10k trigger below).
- **Sends: keep Postmark.** HubSpot is the contact store; Postmark stays the
  mailer. Our own suppression list stays authoritative.
- **Deals: out of scope.** Basic read-only list pulled live from HubSpot, no
  in-app pipeline editing.

## Portal snapshot (live introspection)

| | |
|---|---|
| Portal | **Fumopay Ltd** (`9175484`), EU1 — `app-eu1.hubspot.com` |
| Currency / TZ | GBP / Europe/London |
| Contacts | **10,867** |
| Companies | **5,530** |
| Deals | **184** (3 pipelines: Sales Pipeline·11, New Sales Pipeline·7, Partners·5) |

## Scope: what lives where

**HubSpot (system of record):** contacts, companies, contact↔company
associations, and inbound activity (as engagements/timeline).

**Supabase (stays — app operational store):** `user_settings` (booking,
Google Calendar, reply-to), meetings + calendar sync, `/alerts` triage queue,
`demos`, and all send/sequence/suppression/newsletter logs.

## Architecture & the 10k trigger

Live-read + cache carries Phases 1–4 (the contacts page is 100/row paginated —
cheap to read live). **The ~10.9k-contact base is the trigger for the "mirror
later" step:** the Phase 5 mailer needs set operations over the whole base
(segment ∧ not-suppressed ∧ not-emailed-in-30d), which is painful and
rate-limited against HubSpot Search live. Expect to build the webhook mirror
when we start the mailer, not before.

## Field mapping — Contacts

| App (`contacts`) | HubSpot (`CONTACT`) | Notes |
|---|---|---|
| `full_name` | `firstname` + `lastname` | split on write; read `hs_full_name_or_email` |
| `email` | `email` | native (match key) |
| `job_title` | `jobtitle` | native |
| `mobile` | `mobilephone` | native (`phone` as fallback) |
| company link | **association → COMPANY** | replaces `organisation_id` FK |
| `status='new'` | `hs_lead_status = NEW` | native enum. "Actioned" → `IN_PROGRESS`/`ATTEMPTED_TO_CONTACT` |
| `email_guessed=true` | `email_status = Extrapolated` | **reuse** existing custom (Extrapolated/Unverified/Verified); confirmed → `Verified` |
| `email_status='bounced'` | native bounce (`hs_email_hard_bounce_reason_enum`) | HubSpot sets on bounce; don't reuse the custom `email_status` for this |
| `lead_source` ('whitepaper'/'website') | **`lead_source`** | CREATE custom (traffic-source props aren't granular enough) |
| lead/timeline events | engagements (notes/emails) | Phase 3 |

## Field mapping — Companies

| App (`organisations`) | HubSpot (`COMPANY`) | Notes |
|---|---|---|
| `name` | `name` | native (match key) |
| `website` | `domain` / `website` | native |
| `sector` (bank/broker/…) | `industry` **or** custom `sector` | HubSpot `industry` is generic (~150); our finance sectors likely need a custom enum |
| `tier` | **`tier`** | CREATE custom (number) |
| `is_partner` | **`is_partner`** | CREATE custom (bool) — or derive from Partners deal pipeline |
| `icp` | **`icp`** | CREATE custom (bool) |

## Custom properties to create

- CONTACT: `lead_source` (single-line text).
- COMPANY: `tier` (number), `is_partner` (bool), `icp` (bool), and `sector`
  (enum) if we don't fold into native `industry`.

`status`→`hs_lead_status` and `email_guessed`→`email_status` reuse existing
properties — no new fields needed there.

## Private App scopes (you create the token)

Create at → https://app-eu1.hubspot.com/private-apps/9175484

- `crm.objects.contacts.read`, `crm.objects.contacts.write`
- `crm.objects.companies.read`, `crm.objects.companies.write`
- `crm.objects.deals.read` (read-only list)
- `crm.schemas.contacts.write`, `crm.schemas.companies.write` (create the custom props)
- `crm.objects.owners.read` (owner mapping)
- later: webhooks (mirror), `crm.lists.read` (segments)

## Phased build plan

- **P0 — mapping & access** ✅ Portal confirmed; custom props created
  (`lead_source`, company `tier`/`is_partner`/`icp`); Service Key in use.
- **P1 — repository abstraction + read client** ✅ `crm` interface + getCrm()
  backend flag; raw-fetch HubSpot client (Bearer, 429 back-off, TTL cache);
  pure mapping; 20 mapping tests.
- **P2 — flip reads** ✅ `/contacts` + `/companies` read HubSpot behind the
  flag; search, tabs, sort, cursor paging, badges.
- **P3 — write path** ✅
  - P3a: lead forms (`/api/leads`, `/enquire`) write to HubSpot; match-by-email
    dedupe, company assoc, `hs_lead_status=NEW`, **assigned to Jim Fell**
    (owner 86510668). Timeline Note best-effort (needs notes write scope).
  - P3b: in-app contact detail (edit name/email/title/mobile, mark-actioned,
    confirm email).
  - P3c: in-app company detail (edit tier/partner/icp + contacts) and a
    read-only deals list (pipeline › stage labels, amounts).
  - Remaining: contact/company add + delete on the HubSpot path.
- **P4 — decommission** Supabase CRM tables (keep operational ones).
- **P5 — mailer** on the HubSpot base via Postmark. Operational-data decision
  made: **hybrid** (metrics in Supabase `hs_sends` keyed by HubSpot contact id;
  suppression shared email-keyed; key events mirrored to HubSpot).
  - ✅ Foundation: audience (HubSpot segments) → approval queue → send with
    guardrails (auto-pause / window / warm-up+cap / suppression); `hs_sends`
    log; Note mirrored to HubSpot timeline. CLI: `npm run hs-mailer`.
  - ✅ Webhook loop: Postmark Click/Bounce → `hs_sends`; replies → `replied`
    + opt-out suppression for non-Supabase senders.
  - ✅ Fixed a silently-broken suppression upsert (expression index vs
    onConflict) — bounces/complaints/opt-outs now actually suppress, both
    mailers. `addSuppression` helper + `npm run backfill-suppressions`.
  - Remaining: campaign UI in the console; optional AI per-contact drafting
    (reuse the voice spec) instead of flat templates.
  - To send for real: set `POSTMARK_SERVER_TOKEN`. To flip prod CRM to
    HubSpot: set `HUBSPOT_TOKEN` on Vercel.

## Open items

- `sector`: fold into native `industry` or keep a custom enum? (finance-specific)
- `is_partner`: custom bool vs derive from the Partners deal pipeline.
- Owner mapping: app `owner_id` (Supabase auth uuid) → HubSpot `hubspot_owner_id`.
  Need a user→owner lookup table.
- Contact match on write: email is the natural key; decide merge behaviour when
  HubSpot already has the contact (update vs skip).

---

## Personalised outreach engine (post-pivot, 2026-10)

The mailer was reframed from blanket campaigns/sequences to a **personalisation
workflow engine** (Jim's strategy: quality > quantity, "done our homework",
content-first, stay present, pounce on intent). Built and live in dev:

**Drafting**
- `src/lib/mailer/draft.ts` — bespoke per-contact email tied to ONE CC page, in
  the rep's voice. `DraftConfig` (sign-off/close/tone/length/subject) per
  salesperson via **Settings → Outreach voice** (`user_settings.draft_config`,
  migration 040; `loadDraftConfig`). Anonymisation-guarded. `trigger_note` for
  inbound events. Defaults = Jim's voice (valued-partner, short, "Thanks, Jim").
- `creditcanary-site.md` — website content map the drafter picks from
  (`npm run site-markdown` from crawled content_assets).
- Per-contact research → HubSpot **contact Context** field (`npm run
  enrich-context`): Serper (`src/lib/search/serp.ts`) + Claude, strictly
  grounded (`src/lib/mailer/research.ts`). Company Context field too.

**Campaign type 1 — outbound** (`src/lib/mailer/workflow.ts`, `npm run workflow`)
segment → research + draft per contact → review queue; high research-confidence
auto-approved, rest queued. Keystone UI: **Outreach → Workflow** (`/outreach`).

**Campaign type 2 — deal-nurture** (`src/lib/mailer/nurture.ts`, `npm run
nurture`) owner's open deals → MEDDICC appraisal (`deal_appraisals`, migration
042) → next-step nudge to the deal contact; skips deals contacted this week.

**Send + track** — `hs_sends` (migration 039) queue; `runHsSendBatch` sends
approved slowly (auto-pause/window/warm-up/suppression), tags CC links with
`cc_cid` for GA4, logs each as a HubSpot **email activity**. Webhook loop:
click/bounce/reply → hs_sends; **first click → HubSpot task** (pounce on intent).
`hs_sends.meta` (migration 041). Suppression fixed (addSuppression; onConflict
bug). Engagement associations fixed (typed ids: note 202 / email 198 / task 204).

**Inbound follow-ups** (`src/lib/mailer/inbound.ts`, migration 043) — download/
enquiry (lead capture), abandonment (`POST /api/inbound/abandonment`), booking
(`/book`) enqueue → cron `/api/cron/inbound` (15m) / `npm run inbound-followups`
drafts warm, event-aware follow-ups into the review queue.

### Still open
- **GA4 deep-intent**: needs GA4 property ID + a service-account JSON key in
  `.env.local` + Data API (`analyticsdata.googleapis.com`) enabled + a `cc_cid`
  custom dimension on the site's GA4. Then: ingest visits by cc_cid → high-intent
  → HubSpot task. (Click-based intent already live.)
- **Content page** in-app (who-it's-for / when-to-send) over the site map.
- **Per-user HubSpot owner mapping** (`user_settings.hubspot_owner_id`) so each
  rep nurtures *their* deals — currently defaults to Jim (86510668).
- **To send for real**: set `POSTMARK_SERVER_TOKEN`. **Prod CRM on HubSpot**:
  set `HUBSPOT_TOKEN` on Vercel.

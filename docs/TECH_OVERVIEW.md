# veepveep — Technical Overview

_Credit Canary's warm-CRM outreach engine. Last updated 2026-10-28._

## Stack

- **Framework:** Next.js **16.2.1** (App Router) — React **19**, TypeScript 5.
  Server Components + Server Actions do the work; very little client-side JS.
- **Styling:** Tailwind CSS **v4**. Validation with **Zod**; tests with **vitest**.
- **Shape:** one app, not a separate API + frontend. Pages render server-side,
  mutations are server actions, and a handful of `/api/*` routes handle webhooks,
  the public lead-capture endpoint, and cron jobs.

### Data layer
- **HubSpot is the system of record** for CRM data (companies, contacts, deals),
  read and written over HubSpot's REST API via a service-key client.
- **Supabase Postgres** holds operational data (send logs, drafts, alerts,
  inbound follow-ups, user settings, intent signals) **and** the nightly HubSpot
  mirror.
- The app reaches CRM through a single `CrmRepository` interface (`getCrm()`), so
  the source can be swapped. This is what powers **auto-failover**: when HubSpot
  is unreachable, reads are served transparently from the Supabase mirror.

### AI, email & integrations
- **AI:** Anthropic Claude (`@anthropic-ai/sdk`) — drafting, research, MEDDICC.
- **Email:** Postmark — broadcast stream (outreach), transactional
  (alerts/notifications), inbound (replies).
- **Other:** GA4 (intent signals), Serper (research), Microsoft/Outlook
  (calendar), Granola (meeting notes).

## Auth

- **Supabase Auth**, email + password (`signInWithPassword`), cookie-based
  sessions via `@supabase/ssr`.
- **`middleware.ts` gates the entire app** — every request refreshes the session
  and redirects to `/login` unless authenticated. Public exceptions are explicit:
  - lead / inbound APIs — guarded by their own `LEAD_API_KEY`
  - Postmark & cron webhooks — guarded by `CRON_SECRET`
  - public pages: `/book`, `/enquire`, `/demo`, `/unsubscribe`
- Operators live in Supabase Auth, with profile/role data in a `user_settings`
  table (mapping each user to their HubSpot owner id). Server-side calls use the
  Supabase **service-role** key.

## Hosting

- **Vercel** — auto-deploys on push to `main` (serverless functions + edge
  middleware). Custom domain **veepveep.co.uk**.
- **Vercel Cron** runs the scheduled jobs (drafting, sending, alerts, GA4 intent,
  the nightly HubSpot mirror + watchdog), all defined in `vercel.json` and all
  `CRON_SECRET`-protected.
- **Supabase** is the managed Postgres (separate service); migrations are applied
  manually via the Supabase SQL editor. Secrets/config are Vercel env vars.

## Resilience (HubSpot outage handling)

| Layer | What it does |
|-------|--------------|
| Nightly mirror | Clones all HubSpot contacts/companies/deals → Supabase (03:00 UTC) |
| Failure alert | Emails ops if any mirror run errors or throws |
| Staleness watchdog | Emails ops if no successful run in ~26h (catches a cron that never fired) |
| Auto-failover | Serves CRM **reads** from the mirror when HubSpot is down (writes pause with a clear error) |

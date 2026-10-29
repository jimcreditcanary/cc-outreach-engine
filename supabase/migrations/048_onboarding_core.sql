-- Merchant onboarding — Phase 1 core tables (case, stakeholders, event log).
-- The rest of the onboarding data model (company snapshot, directors, UBOs,
-- merchant form sections/audit/sessions, uploads, CoP, nudges) lands in later
-- migrations as each phase needs it, so every "run this SQL" stays small.
--
-- RLS is ENABLED with no policies on these tables (deny-all). All app access is
-- server-side via serviceClient() (SUPABASE_SERVICE_ROLE_KEY), which bypasses
-- RLS — so the app works unchanged while the anon/authenticated keys get zero
-- rows. This is deliberate defence-in-depth: these tables will hold UBO DOBs,
-- addresses, passport and bank-account numbers. (Diverges from the repo's older
-- operational tables, which predate this and carry no RLS.)

-- ─── enums (idempotent: CREATE TYPE has no IF NOT EXISTS) ──────────────────────
do $$ begin
  create type onboarding_case_status as enum (
    'started', 'internal_complete', 'merchant_invited', 'merchant_in_progress',
    'merchant_submitted', 'ubo_checks', 'docs_generated', 'awaiting_approval',
    'onboarded', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type onboarding_role as enum (
    'authorised_signatory', 'economic_buyer', 'procurement',
    'finance', 'compliance', 'technical_product'
  );
exception when duplicate_object then null; end $$;

-- ─── onboarding_cases ─────────────────────────────────────────────────────────
create table if not exists public.onboarding_cases (
  id                             uuid primary key default gen_random_uuid(),
  hubspot_deal_id                text,
  hubspot_company_id             text,
  company_number                 text,
  status                         onboarding_case_status not null default 'started',
  product_groups                 text[] not null default '{}',
  api_sandbox_required           boolean not null default false,
  -- Random 32-byte url-safe token, set by the app on create (unguessable public
  -- merchant-form URL). Unique so a token maps to exactly one case.
  merchant_form_token            text not null unique,
  deal_owner_user_id             uuid,
  approver_user_id               uuid,
  approved_at                    timestamptz,
  drive_folder_id                text,
  drive_onboarding_forms_folder_id text,
  drive_supporting_docs_folder_id  text,
  drive_project_mgmt_folder_id     text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);
-- One live case per deal: look up by deal to hide "Start onboarding" / dedupe
-- the closedwon auto-create. (Not unique — a cancelled case may be superseded.)
create index if not exists onboarding_cases_deal_idx on public.onboarding_cases (hubspot_deal_id);
create index if not exists onboarding_cases_company_idx on public.onboarding_cases (hubspot_company_id);
create index if not exists onboarding_cases_status_idx on public.onboarding_cases (status);

create trigger onboarding_cases_touch before update on public.onboarding_cases
  for each row execute function public.touch_updated_at();

alter table public.onboarding_cases enable row level security;

-- ─── onboarding_stakeholders ──────────────────────────────────────────────────
create table if not exists public.onboarding_stakeholders (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.onboarding_cases (id) on delete cascade,
  hubspot_contact_id text not null,
  role               onboarding_role not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (case_id, hubspot_contact_id, role)
);
create index if not exists onboarding_stakeholders_case_idx on public.onboarding_stakeholders (case_id);

create trigger onboarding_stakeholders_touch before update on public.onboarding_stakeholders
  for each row execute function public.touch_updated_at();

alter table public.onboarding_stakeholders enable row level security;

-- ─── onboarding_events (append-only audit/event log) ──────────────────────────
-- Every state change writes a row here; this is also what's copied into a
-- HubSpot company note at approval (Phase 5). No updated_at — append-only.
create table if not exists public.onboarding_events (
  id             bigint generated always as identity primary key,
  case_id        uuid not null references public.onboarding_cases (id) on delete cascade,
  event          text not null,
  actor_user_id  uuid,
  actor_email    text,
  payload        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists onboarding_events_case_idx on public.onboarding_events (case_id, created_at);

alter table public.onboarding_events enable row level security;

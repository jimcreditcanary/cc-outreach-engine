-- Billing agent — Phase 1 core tables + the operator role column.
--
-- Naming: every billing table is prefixed `billing_` (the brief's bare names
-- like `invoices` / `pricing_tables` would collide in this shared DB; this keeps
-- the domain cohesive, matching the `onboarding_` convention).
--
-- Money is stored as INTEGER PENCE everywhere (unit prices, minimums); format
-- at the edge. Usage/invoice/dunning tables land in their own later migrations
-- so each "run this SQL" stays small.
--
-- Fully idempotent (if-not-exists tables/indexes/column + create-or-replace
-- triggers), so it is safe to re-run; re-running also refreshes the PostgREST
-- schema cache.
--
-- RLS is ENABLED with no policies (deny-all). All access is server-side via
-- serviceClient() (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS — same
-- defence-in-depth pattern as the onboarding tables. Pricing is config, but
-- billing_accounts/items reference financial data, so we lock the lot down.

-- ─── operator role (super_admin gates /admin/pricing + overrides) ─────────────
-- user_settings predates this and has no role column. Default everyone to
-- 'operator'; elevate yourself with:
--   update public.user_settings set role = 'super_admin' where user_id = '<your-auth-uuid>';
alter table public.user_settings
  add column if not exists role text not null default 'operator';

-- ─── billing_pricing_tables (super-admin catalogue, effective-dated versions) ──
create table if not exists public.billing_pricing_tables (
  id             uuid primary key default gen_random_uuid(),
  item_type      text not null,              -- closed set (src/lib/billing/catalogue.ts)
  name           text not null,
  product_group  text,                       -- onboarding product-group key / 'core' / 'comms'
  metric         text not null,              -- validated in app against METRICS
  config         jsonb not null default '{}'::jsonb,   -- caps, included flag, pct, per-application amount…
  vat_treatment  text not null default 'standard',     -- standard | exempt | out_of_scope
  is_placeholder boolean not null default true,         -- seeded placeholder vs finance-confirmed
  version        integer not null default 1,
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists billing_pricing_tables_item_idx on public.billing_pricing_tables (item_type, effective_from desc);
create or replace trigger billing_pricing_tables_touch before update on public.billing_pricing_tables
  for each row execute function public.touch_updated_at();
alter table public.billing_pricing_tables enable row level security;

-- ─── billing_pricing_bands (graduated tiers for a pricing-table version) ───────
create table if not exists public.billing_pricing_bands (
  id               uuid primary key default gen_random_uuid(),
  pricing_table_id uuid not null references public.billing_pricing_tables (id) on delete cascade,
  from_units       integer not null default 0,
  to_units         integer,                  -- null = unbounded (top band)
  unit_price_pence integer not null default 0,
  minimum_type     text not null default 'none',   -- none | monthly | on_band_hit
  minimum_pence    integer not null default 0,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists billing_pricing_bands_table_idx on public.billing_pricing_bands (pricing_table_id, sort_order);
alter table public.billing_pricing_bands enable row level security;

-- ─── billing_accounts (one per onboarded company) ─────────────────────────────
create table if not exists public.billing_accounts (
  id                 uuid primary key default gen_random_uuid(),
  onboarding_case_id uuid references public.onboarding_cases (id) on delete set null,
  hubspot_company_id text,
  hubspot_deal_id    text,
  xero_contact_id    text,
  contract_start_date date,
  contract_signed_at timestamptz,
  notice_period_days integer,
  contract_end_date  date,
  status             text not null default 'setup_pending',   -- setup_pending | active | notice_given | cancelled | disputed
  finance_contact_id text,                  -- hubspot contact id (finance stakeholder)
  deal_owner_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- One billing account per onboarding case (the reconcile cron relies on this).
create unique index if not exists billing_accounts_case_uidx on public.billing_accounts (onboarding_case_id) where onboarding_case_id is not null;
create index if not exists billing_accounts_company_idx on public.billing_accounts (hubspot_company_id);
create index if not exists billing_accounts_status_idx on public.billing_accounts (status);
create or replace trigger billing_accounts_touch before update on public.billing_accounts
  for each row execute function public.touch_updated_at();
alter table public.billing_accounts enable row level security;

-- ─── billing_items (per account — Phase 2 setup wizard populates) ─────────────
create table if not exists public.billing_items (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.billing_accounts (id) on delete cascade,
  pricing_table_id uuid references public.billing_pricing_tables (id),
  item_type        text not null,
  config           jsonb not null default '{}'::jsonb,
  vat_treatment    text,                     -- defaults from the pricing table
  override         jsonb,                    -- super-admin price/band override
  override_by      uuid,
  override_reason  text,
  usage_api_key_hash text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists billing_items_account_idx on public.billing_items (account_id);
create or replace trigger billing_items_touch before update on public.billing_items
  for each row execute function public.touch_updated_at();
alter table public.billing_items enable row level security;

-- ─── billing_contract_status_events (append-only) ─────────────────────────────
create table if not exists public.billing_contract_status_events (
  id           bigint generated always as identity primary key,
  account_id   uuid references public.billing_accounts (id) on delete cascade,
  status       text not null,
  effective_at timestamptz not null default now(),
  source       text not null default 'ui',   -- api | ui
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists billing_contract_status_events_acct_idx on public.billing_contract_status_events (account_id, created_at);
alter table public.billing_contract_status_events enable row level security;

-- ─── billing_hubspot_line_items_mirror (read-only copy for reporting) ─────────
create table if not exists public.billing_hubspot_line_items_mirror (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.billing_accounts (id) on delete cascade,
  hubspot_line_item_id text,
  name                text,
  sku                 text,
  quantity            numeric,
  price               numeric,
  amount              numeric,
  term                text,
  properties          jsonb,
  mirrored_at         timestamptz not null default now()
);
create index if not exists billing_hs_line_items_acct_idx on public.billing_hubspot_line_items_mirror (account_id);
alter table public.billing_hubspot_line_items_mirror enable row level security;

-- Force PostgREST (the REST API the app + seed use) to reload its schema cache
-- so the new tables/column are visible immediately after this runs.
notify pgrst, 'reload schema';

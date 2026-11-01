-- Billing agent — Billing v2: the Product Library.
--
-- Turns the fixed 26-item catalogue (src/lib/billing/catalogue.ts) into an
-- open, DB-driven product library the UI can extend. No teardown: a "product"
-- is a billing_pricing_tables row and a "variant" is a billing_pricing_bands
-- row — this migration just adds the columns the v2 model (billingv2.xlsx)
-- needs. item_type stays the stable product key but is no longer validated
-- against a closed code set.
--
-- Money is INTEGER PENCE everywhere. Additive + idempotent (safe to re-run;
-- re-running also refreshes the PostgREST schema cache). RLS stays deny-all —
-- all access via serviceClient(). Ends with the schema-cache reload.

-- ─── products (billing_pricing_tables) ────────────────────────────────────────
alter table public.billing_pricing_tables
  add column if not exists product_type        text    not null default 'variable', -- fixed | variable
  add column if not exists band_mode           text    not null default 'volume',   -- volume | graduated
  add column if not exists billing_frequency   text,                                -- monthly | one_off | null (usage)
  add column if not exists billing_term_months integer,                             -- how many months this line bills (null = contract length)
  add column if not exists delayed_start_months integer not null default 0,         -- months after contract start before this line begins
  add column if not exists active              boolean not null default true,        -- retire a product without deleting history
  add column if not exists sort_order          integer not null default 0,          -- UI ordering within a product_group
  add column if not exists internal_notes      text;                                -- the sheet's "internal_notes" column

create index if not exists billing_pricing_tables_group_idx on public.billing_pricing_tables (product_group, sort_order);
create index if not exists billing_pricing_tables_active_idx on public.billing_pricing_tables (active) where active;

-- ─── variants (billing_pricing_bands) ─────────────────────────────────────────
-- A per-band monthly minimum is the existing (minimum_type='monthly',
-- minimum_pence) pair — no new column needed. We add a per-transaction cap (the
-- sheet's unit_cap, e.g. Pay-by-Bank % capped at £3) and a label for the UI.
alter table public.billing_pricing_bands
  add column if not exists unit_cap_pence integer,        -- per-txn cap on a % component (null = uncapped)
  add column if not exists variant_label  text;           -- optional human label for the tier

-- ─── product-group minimum spend (the sheet's "minimum for a whole category") ─
-- A monthly floor across every billed line in a product_group (e.g. all TU
-- items must bill ≥ £X/month). Catalogue-level default; a per-account override
-- can layer on later. Effective-dated like pricing.
create table if not exists public.billing_group_minimums (
  id             uuid primary key default gen_random_uuid(),
  product_group  text not null,
  minimum_pence  integer not null default 0,
  note           text,
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists billing_group_minimums_group_idx on public.billing_group_minimums (product_group, effective_from desc);
create or replace trigger billing_group_minimums_touch before update on public.billing_group_minimums
  for each row execute function public.touch_updated_at();
alter table public.billing_group_minimums enable row level security;

-- ─── contract inputs (billing_accounts — the sheet's "Overarching Inputs") ────
alter table public.billing_accounts
  add column if not exists auto_renew            boolean,                 -- TRUE | FALSE
  add column if not exists term_months           integer,                 -- committed term (e.g. 36)
  add column if not exists break_months          integer,                 -- break clause, months from start (null = none)
  add column if not exists renewal_decision_date date,                    -- when the renew/notice decision is due
  add column if not exists billing_type          text not null default 'draft'; -- draft | auto (Xero: push as DRAFT vs AUTHORISED)

notify pgrst, 'reload schema';

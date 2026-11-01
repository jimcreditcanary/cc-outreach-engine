-- CRM: an explicit "customer" flag per HubSpot company — a dedicated mark
-- (separate from the HubSpot current_client property) that drives the Customers
-- tab. Local-only: we never write it back to HubSpot. Keyed by HubSpot company
-- id. RLS deny-all; all access via serviceClient(). Idempotent; ends with a
-- PostgREST schema-cache reload.

create table if not exists public.crm_customer_flags (
  hubspot_company_id text primary key,
  is_customer        boolean not null default true,
  customer_since     timestamptz not null default now(),
  marked_by          uuid,
  updated_at         timestamptz not null default now()
);
create index if not exists crm_customer_flags_is_customer_idx on public.crm_customer_flags (is_customer) where is_customer;
create or replace trigger crm_customer_flags_touch before update on public.crm_customer_flags
  for each row execute function public.touch_updated_at();
alter table public.crm_customer_flags enable row level security;

notify pgrst, 'reload schema';

-- Prospect demo links. From /companies, an operator generates a branded,
-- shareable landing page (/demo/<slug>) that showcases the console styled in
-- the prospect's own brand — colours, logo, tone, product type — pulled from
-- their website by Claude, with a manual review/override step before commit.

create table if not exists public.demos (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  organisation_id uuid references public.organisations(id) on delete set null,
  owner_id        uuid references auth.users(id) on delete set null,
  company_name    text not null,
  company_url     text,
  -- logo_url holds either an external URL (lifted from the site) or a
  -- data: URI (when the operator uploads a replacement). Both render as <img>.
  logo_url        text,
  bg_color        text,         -- brand hex, e.g. #00AEEF
  tone            text,         -- short tone-of-voice descriptor
  product_type    text,         -- one of the fixed product set
  description     text,         -- LHS pitch copy for the landing page
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists demos_org_idx on public.demos (organisation_id);
create index if not exists demos_owner_idx on public.demos (owner_id);

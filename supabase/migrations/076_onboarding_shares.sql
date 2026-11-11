-- Secure third-party sharing of the onboarding review. A veepveep user creates a
-- share link for a case and sends it to a third party. The recipient enters
-- their email on the share page and is sent a one-time, 7-day read-only view
-- link via Postmark. Every email entered and every view is logged (who + when),
-- surfaced on the case timeline. RLS deny-all; all access via serviceClient().

create table if not exists public.onboarding_shares (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.onboarding_cases(id) on delete cascade,
  token            text not null unique,          -- the shareable URL credential
  created_by_email text,                          -- the veepveep user who created it
  label            text,                          -- optional note (e.g. recipient org)
  revoked_at       timestamptz,                   -- null = active
  created_at       timestamptz not null default now()
);
create index if not exists onboarding_shares_case_idx on public.onboarding_shares (case_id);
alter table public.onboarding_shares enable row level security;

-- One row per "recipient entered their email" → a 7-day one-time view link.
create table if not exists public.onboarding_share_access (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references public.onboarding_shares(id) on delete cascade,
  recipient_email text not null,
  access_token    text not null unique,           -- the one-time-link credential
  expires_at      timestamptz not null,           -- created_at + 7 days
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  view_count      integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists onboarding_share_access_share_idx on public.onboarding_share_access (share_id);
alter table public.onboarding_share_access enable row level security;

notify pgrst, 'reload schema';

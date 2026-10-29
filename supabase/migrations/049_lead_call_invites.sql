-- Lead call-invite sequence. When a lead is captured we instantly email them a
-- call invite (HubSpot meetings link) with a "just give me sandbox access"
-- option, then chase at 48h and 7 days unless they book or opt for sandbox.
-- One row per lead (by email); the chase cron reads this table.
--
-- RLS enabled, no policies (deny-all) — holds lead PII; all access is via
-- serviceClient() which bypasses RLS. (Same stance as the onboarding tables.)

create table if not exists public.lead_call_invites (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,            -- stored lowercased; the identity + booking-match key
  hs_contact_id        text,                     -- HubSpot contact id when known
  name                 text,
  company              text,
  owner_id             uuid,
  source               text,
  asset                text,
  -- Unguessable token for the public "just give me sandbox access" link.
  token                text not null unique,
  invited_at           timestamptz,              -- when the instant invite was sent (null = not sent yet)
  chase_48h_at         timestamptz,
  chase_7d_at          timestamptz,
  booked_at            timestamptz,              -- detected meeting → stop chasing
  sandbox_opt_out_at   timestamptz,              -- clicked "just sandbox" → stop chasing
  status               text not null default 'active',  -- active | booked | sandbox | expired
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint lead_call_invites_email_uniq unique (email)
);
create index if not exists lead_call_invites_status_idx on public.lead_call_invites (status, invited_at);

create trigger lead_call_invites_touch before update on public.lead_call_invites
  for each row execute function public.touch_updated_at();

alter table public.lead_call_invites enable row level security;

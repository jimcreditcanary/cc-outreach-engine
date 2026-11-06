-- App-wide integration settings (singleton) — config that isn't per-user.
-- First use: the onboarding export webhook (ONBOARDING_WEBHOOK_URL / _SECRET),
-- now editable from Settings instead of only via Vercel env. The webhook read
-- path falls back to the env vars when a column is blank, so this is additive.
create table if not exists public.app_settings (
  id                         boolean primary key default true,
  onboarding_webhook_url     text,
  onboarding_webhook_secret  text,
  updated_at                 timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

-- Seed the single row so upserts always target it.
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

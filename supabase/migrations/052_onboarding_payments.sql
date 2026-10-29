-- Phase 3b — payment/settlement bank accounts (numbers ENCRYPTED at rest),
-- the Direct Debit sub-form, and Confirmation-of-Payee results.
--
-- Sort codes + account numbers are stored only as AES-256-GCM ciphertext
-- (src/lib/onboarding/crypto.ts, ENCRYPTION_KEY) — the plaintext never lands in
-- a column or a log. RLS enabled, deny-all (service-role bypasses).

create table if not exists public.onboarding_bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.onboarding_cases (id) on delete cascade,
  purpose          text not null,              -- settlement | disbursal | direct_debit
  account_name     text,
  bank_name        text,
  sort_code_enc    text,                       -- AES-256-GCM ciphertext
  account_number_enc text,                     -- AES-256-GCM ciphertext
  account_tail     text,                       -- last 4 of the account number, for safe display
  -- Confirmation of Payee outcome for this account (null until checked).
  cop_result       text,                       -- match | close_match | no_match | unavailable
  cop_matched_name text,
  cop_checked_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists onboarding_bank_accounts_case_idx on public.onboarding_bank_accounts (case_id);

create trigger onboarding_bank_accounts_touch before update on public.onboarding_bank_accounts
  for each row execute function public.touch_updated_at();

alter table public.onboarding_bank_accounts enable row level security;

-- Direct Debit sub-form — non-sensitive questionnaire fields as jsonb (the bank
-- account itself is an onboarding_bank_accounts row with purpose='direct_debit').
create table if not exists public.onboarding_direct_debit (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null unique references public.onboarding_cases (id) on delete cascade,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger onboarding_direct_debit_touch before update on public.onboarding_direct_debit
  for each row execute function public.touch_updated_at();

alter table public.onboarding_direct_debit enable row level security;

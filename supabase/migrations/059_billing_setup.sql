-- Billing agent — Phase 2 (setup wizard) additions.
-- Idempotent; ends with a PostgREST schema-cache reload so the REST API sees
-- the new column/table immediately (billing migrations always do this).
-- RLS deny-all; all access via serviceClient().

-- PO number captured in the setup wizard (optional).
alter table public.billing_accounts
  add column if not exists po_number text;

-- Money-affecting change log (brief §3: pricing edits, overrides, item changes
-- logged with actor + reason). Append-only.
create table if not exists public.billing_audit_log (
  id              bigint generated always as identity primary key,
  account_id      uuid references public.billing_accounts (id) on delete cascade,
  billing_item_id uuid references public.billing_items (id) on delete set null,
  actor_user_id   uuid,
  actor_email     text,
  action          text not null,     -- e.g. items_configured | account_activated | item_override | pricing_edit
  reason          text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists billing_audit_log_account_idx on public.billing_audit_log (account_id, created_at);
alter table public.billing_audit_log enable row level security;

-- One-time usage-key reveal buffer. On activation the plaintext per-item keys
-- are written here; the reveal page shows them once then deletes the row (only
-- the SHA-256 hash is kept on billing_items). Short-lived (TTL enforced in app).
create table if not exists public.billing_key_reveals (
  nonce      text primary key,
  account_id uuid references public.billing_accounts (id) on delete cascade,
  reveals    jsonb not null,   -- [{ item_type, label, key }]
  created_at timestamptz not null default now()
);
alter table public.billing_key_reveals enable row level security;

notify pgrst, 'reload schema';

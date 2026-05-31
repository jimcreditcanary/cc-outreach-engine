-- Capture WHY someone unsubscribed + WHEN (if ever) we can re-engage.
-- The base `suppressions` table just has email + reason enum + ts; this
-- bolts on the structured feedback that feeds re-targeting / win-back later.
alter table public.suppressions add column if not exists why          text;
alter table public.suppressions add column if not exists recontact_at timestamptz;
alter table public.suppressions add column if not exists note         text;

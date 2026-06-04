-- 032_event_owner.sql
--
-- events.owner_id — who the event "belongs to" from an inbox / queue
-- perspective. For replies this is set to the operator whose
-- user_settings.reply_to_email matches the inbound To address (so
-- /replies can filter to "my replies"). For other event types the
-- existing owner of the related contact/org cascade applies, but a
-- direct column gives us an indexable filter without joins.
--
-- Nullable: legacy events (and ones we can't pin to an operator —
-- typical of cron-generated press/system events) stay null.

alter table public.events
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists events_owner_type_idx
  on public.events (owner_id, type, ts desc);

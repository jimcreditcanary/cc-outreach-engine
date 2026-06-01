-- Migration 018: multi-user — owner_id on key CRM entities.
-- Every operator gets their own slice of the CRM. owner_id is the assignee
-- for filtering lists/dashboard ("show me my pipeline"). Nullable so legacy
-- rows + cron-generated rows without a contact-owner still insert.

alter table public.organisations add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.contacts      add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.deals         add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.sends         add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.meetings      add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists organisations_owner_idx on public.organisations (owner_id);
create index if not exists contacts_owner_idx      on public.contacts      (owner_id);
create index if not exists deals_owner_idx         on public.deals         (owner_id);
create index if not exists sends_owner_idx         on public.sends         (owner_id);
create index if not exists meetings_owner_idx      on public.meetings      (owner_id);

-- Backfill: claim every existing row for the first/oldest auth user (today
-- this is Jim). New operators added later see an empty queue until things
-- get assigned to them.
do $$
declare first_user uuid := (select id from auth.users order by created_at asc limit 1);
begin
  if first_user is not null then
    update public.organisations set owner_id = first_user where owner_id is null;
    update public.contacts      set owner_id = first_user where owner_id is null;
    update public.deals         set owner_id = first_user where owner_id is null;
    update public.sends         set owner_id = first_user where owner_id is null;
    update public.meetings      set owner_id = first_user where owner_id is null;
  end if;
end $$;

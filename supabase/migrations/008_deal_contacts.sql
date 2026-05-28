-- Proper deal <-> contact links (stakeholders). Replaces the lone
-- contacts.is_deal_stakeholder flag, which couldn't say WHICH deal.
-- A deal keeps a single primary_contact_id (already on deals) plus any
-- number of stakeholders here.
create table if not exists public.deal_contacts (
  deal_id    uuid not null references public.deals(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role       text,
  created_at timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

create index if not exists deal_contacts_contact_idx on public.deal_contacts (contact_id);

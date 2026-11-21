-- Per-IP throttle for public lead capture (/api/leads). Each accepted submission
-- that carries a forwarded client IP records a row here; the route rejects an IP
-- that exceeds the hourly/daily cap. Append-only; old rows are pruned on write.
-- RLS deny-all; all access via serviceClient(). Fail-open: a DB error never
-- blocks a genuine lead.

create table if not exists public.lead_ip_hits (
  id         bigint generated always as identity primary key,
  ip         text not null,
  source     text,
  created_at timestamptz not null default now()
);
create index if not exists lead_ip_hits_ip_time_idx on public.lead_ip_hits (ip, created_at desc);

alter table public.lead_ip_hits enable row level security;

notify pgrst, 'reload schema';

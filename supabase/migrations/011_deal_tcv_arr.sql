-- Pipeline reporting needs proper deal sizing. `value` was ambiguous; split
-- into TCV (Total Contract Value, full term) + ARR (Annual Recurring
-- Revenue). Existing `value` is backfilled into `tcv` so dashboards keep
-- working without a manual data fix.
alter table public.deals add column if not exists tcv numeric;
alter table public.deals add column if not exists arr numeric;
update public.deals set tcv = value where tcv is null and value is not null;

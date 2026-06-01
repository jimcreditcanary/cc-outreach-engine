-- Custom fields per entity type (organisation / contact / deal). Schema
-- managed via UI: definitions live in custom_field_defs, values are stored
-- in a jsonb column on each entity keyed by the def's field_key. Adding a
-- new field is therefore an INSERT into custom_field_defs — no migration.

create table if not exists public.custom_field_defs (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null check (entity_type in ('organisation', 'contact', 'deal')),
  field_key      text not null,
  field_label    text not null,
  field_type     text not null check (field_type in ('text', 'number', 'date', 'select', 'checkbox', 'textarea')),
  options        text[] not null default '{}',
  display_order  int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (entity_type, field_key)
);

alter table public.organisations add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.contacts      add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.deals         add column if not exists custom_fields jsonb not null default '{}'::jsonb;

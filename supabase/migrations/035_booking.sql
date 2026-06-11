-- Public booking pages (Calendly replacement). Each operator gets a
-- shareable /book/<slug> page; availability = working hours minus busy
-- slots from their connected calendars minus existing meetings rows.
-- Config lives on user_settings (one page per operator, like the sender
-- identity). meetings.booked_via marks rows that came in via the page.

alter table public.user_settings
  add column if not exists booking_slug text,
  add column if not exists booking_duration_mins integer not null default 30,
  add column if not exists booking_buffer_mins integer not null default 15,
  add column if not exists booking_day_start text not null default '09:00',
  add column if not exists booking_day_end text not null default '17:00',
  add column if not exists booking_days jsonb not null default '["mon","tue","wed","thu","fri"]'::jsonb,
  add column if not exists booking_tz text not null default 'Europe/London',
  add column if not exists booking_title_template text,
  add column if not exists booking_min_notice_hours integer not null default 4;

-- Slug resolves the public page — must be unique across operators.
create unique index if not exists user_settings_booking_slug_uidx
  on public.user_settings (booking_slug);

alter table public.meetings
  add column if not exists booked_via text;

-- Per-page outreach guidance for the content map: who the page is best for and
-- when to send it. AI-generated from the page content (npm run content-guidance),
-- surfaced on the in-app /content page and folded into creditcanary-site.md so
-- the drafter picks pages more wisely. Additive.

alter table public.content_assets add column if not exists audience_fit text;
alter table public.content_assets add column if not exists send_timing text;

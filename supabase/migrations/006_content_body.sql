-- ─── content_assets body capture ───────────────────────────────────
--
-- The crawler stores the extracted page text so the targeting-map pass
-- can later AI-tag assets by problem/sector without re-crawling.
--   description — meta description / first paragraph (short).
--   body_text   — full extracted page text (nav/footer stripped).

alter table public.content_assets add column description text;
alter table public.content_assets add column body_text   text;

-- Preserve the body Claude generated, separate from the body that actually
-- gets sent. When you edit in the queue, body_text gets overwritten — the
-- original is the only way the style-learning loop can see what you changed
-- and why (the strongest signal we have for refining the voice spec).
alter table public.sends add column if not exists original_body_text text;

-- Editable email signature: move the hard-coded HTML/text signature into
-- user_settings so the operator can edit it in Settings instead of a code
-- change. Null/empty falls back to the built-in default (src/lib/send/signature.ts),
-- so existing behaviour is unchanged until someone sets a custom one.

alter table public.user_settings add column if not exists email_signature_html text;
alter table public.user_settings add column if not exists email_signature_text text;

notify pgrst, 'reload schema';

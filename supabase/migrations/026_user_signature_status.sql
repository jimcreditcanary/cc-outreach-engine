-- Migration 026: track Postmark sender-signature verification state per user.
--
-- postmark_signature_id already existed (numeric) but had no companion
-- columns for the verified-yet flag or the last-API-error string. Adding
-- them so /settings can render a status pill + a "resend confirmation"
-- button instead of leaving the operator guessing whether the registration
-- worked.

alter table public.user_settings
  add column if not exists postmark_signature_verified boolean,
  add column if not exists postmark_signature_error    text,
  add column if not exists postmark_signature_checked_at timestamptz;

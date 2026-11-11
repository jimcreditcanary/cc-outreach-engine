-- Manual "checked & validated" sign-off on a beneficial owner's identity
-- documents (passport + proof of address). A reviewer confirms the uploaded
-- docs have been checked; the badge then shows on the review + the shared view.
-- Additive — degrades gracefully until applied (the columns just read as null).

alter table public.onboarding_ubo_kyc add column if not exists documents_checked_at timestamptz;
alter table public.onboarding_ubo_kyc add column if not exists documents_checked_by text;

notify pgrst, 'reload schema';

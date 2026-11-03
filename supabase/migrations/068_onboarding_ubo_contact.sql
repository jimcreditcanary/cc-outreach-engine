-- Step 6 P2: UBO contact details on the KYC rows. The beneficial-owners page
-- collects each UBO's email + mobile (used later, if Digital ID&V fails, to send
-- them a document-upload link — no email to the customer, just a shared link).
-- Idempotent; the app degrades (persists without these) until it's applied.

alter table public.onboarding_ubo_kyc
  add column if not exists email  text,
  add column if not exists mobile text;

notify pgrst, 'reload schema';

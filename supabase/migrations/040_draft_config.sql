-- Per-salesperson outreach drafting voice ("prompt builder"). One JSONB blob on
-- user_settings holding the rep's DraftConfig (senderName, signOff, closeLine,
-- toneNotes, lengthGuidance, subjectStyle). Null / missing keys fall back to the
-- app defaults (Jim's voice), so this is purely additive.

alter table public.user_settings add column if not exists draft_config jsonb;

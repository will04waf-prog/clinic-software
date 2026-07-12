-- TARGET ENV: PRODUCTION (project rvoxqjpqbchjdizdhajb — the live app DB).
-- Applied to prod 2026-07-12 via apply_migration.
--
-- Multi-vertical backlog closeout: Spanish booking-confirmation SMS.
--
-- Additive, nullable, no default. When a caller booked in Spanish
-- (contact/caller language 'es'), the confirmation SMS should use this
-- owner-authored Spanish template instead of the English
-- sms_template_confirmation. NULL = fall back to the English template
-- (rendered per vertical), so every existing org is byte-identical to
-- today until an owner writes a Spanish version. Never machine-translated.

alter table public.organizations
  add column if not exists sms_template_confirmation_es text;

comment on column public.organizations.sms_template_confirmation_es is
  'Owner-authored Spanish booking-confirmation SMS template. NULL falls back to the English sms_template_confirmation. Chosen by the caller/contact language, not owner_language.';

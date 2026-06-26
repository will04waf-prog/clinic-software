-- Phase 5 W2 — Organization intake-form URL for the call agent's
-- `send_link_sms` tool (link_kind='intake').
--
-- Layla needs a per-clinic place to send patients when they ask
-- "where do I fill out new-patient paperwork?" Today there's no
-- structured field — owners would have to bake the URL into the
-- greeting copy, which the LLM can neither validate nor SMS in a
-- clean form. Storing it on organizations lets every channel
-- (voice SMS hand-off, automation emails, public booking page)
-- reach for the same canonical link.
--
-- The column is NULL-able with no default. Orgs that don't have a
-- form simply leave it blank, and send_link_sms refuses the
-- `link_kind='intake'` branch with a soft error the LLM can read
-- back ("we don't have an online intake form yet").
--
-- Stored as plain text (no URL validation at the DB layer) — the
-- API layer applies a regex and a length cap. Pasting a raw form
-- builder URL (Jotform, Typeform, custom HIPAA form, Google Form
-- for non-PHI marketing intake) all flow through the same field.
-- Free-form, single-line.

alter table public.organizations
  add column if not exists intake_form_url text;

comment on column public.organizations.intake_form_url is
  'Phase 5 W2: optional URL Layla texts when a caller asks for the intake/new-patient form. Validated and length-capped at the API layer. Blank disables the link_kind=''intake'' branch of send_link_sms.';

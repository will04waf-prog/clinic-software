-- Multi-vertical Phase 2 — bilingual bridge: record the language of a
-- call and a contact's preferred language.
--
-- Strictly additive, both nullable with no default:
--   call_logs.detected_language     — the DOMINANT language of a call,
--                                     as Layla reports it at call-end
--                                     ('en' | 'es'). NULL for calls
--                                     before this shipped and for
--                                     English-only lines that never
--                                     report one.
--   contacts.preferred_language     — the language to follow up with a
--                                     contact in ('en' | 'es'), stamped
--                                     from the same call-end report.
--                                     NULL = unknown → default to
--                                     English / owner_language elsewhere.
--
-- Med-spa impact: none. English-only assistants never emit a
-- detected_language, so both columns stay NULL for existing tenants,
-- and every read path treats NULL as "English / unspecified".
--
-- RLS: columns on call_logs and contacts, both of which already carry
-- their org-scoped policies. New columns are covered automatically; no
-- new policy is added. Phase 5 adds the explicit cross-tenant test.

alter table public.call_logs
  add column if not exists detected_language text
    check (detected_language in ('en', 'es'));

alter table public.contacts
  add column if not exists preferred_language text
    check (preferred_language in ('en', 'es'));

comment on column public.call_logs.detected_language is
  'Multi-vertical Phase 2: dominant language of the call (en|es), reported by Layla via post_call_summary_email and copied here when the call_logs row is written. NULL for pre-feature and English-only calls.';

comment on column public.contacts.preferred_language is
  'Multi-vertical Phase 2: language to follow up with this contact in (en|es), stamped from the call-end language report. NULL = unknown; readers default to English / the org owner_language as appropriate.';

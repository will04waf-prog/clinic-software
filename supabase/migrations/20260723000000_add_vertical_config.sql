-- Multi-vertical foundation — Phase 1.
--
-- Tarhunna is expanding Layla beyond med spas to Spanish-speaking
-- owners of local service businesses (landscaping, cleaning, trades,
-- food). This migration adds the per-tenant config that every later
-- phase reads. It is STRICTLY ADDITIVE and every column defaults to
-- the current med-spa behavior, so existing tenants are unchanged:
--
--   vertical              = 'medspa'  → same prompt, same terminology
--   owner_language        = 'en'      → English OWNER-facing output
--                                       (summaries, notifications) only;
--                                       independent of caller languages
--   caller_languages      = '{en}'    → English-only assistant
--                                       (transcriber + voice + bilingual
--                                       directive), byte-identical to
--                                       today
--   notification_channel  = 'sms'     → no WhatsApp behavior added
--   owner_notify_e164     = NULL      → owner SMS/WA push is inert
--                                       until an owner mobile is set;
--                                       existing email alerts unchanged
--   whatsapp_last_inbound_at = NULL   → no 24h WhatsApp session open
--
-- RLS: these are columns on `organizations`, which already has its
-- org-scoped SELECT/UPDATE policies. New columns are covered by the
-- existing table policies automatically — a member of org A can only
-- ever read/write org A's row. No new policy is added or needed here;
-- Phase 5 adds an explicit cross-tenant test to prove it.
--
-- Design note (single owner number): whatsapp_last_inbound_at tracks
-- the 24h WhatsApp session at the ORG level, assuming one owner
-- WhatsApp number per org (owner_notify_e164). Multi-number owners
-- are out of scope for V1 — see src/lib/notify/session.ts.

alter table public.organizations
  add column if not exists vertical text not null default 'medspa'
    check (vertical in ('medspa', 'trades', 'food', 'general')),
  add column if not exists owner_language text not null default 'en'
    check (owner_language in ('en', 'es')),
  add column if not exists caller_languages text[] not null default '{en}'
    check (
      caller_languages <@ array['en', 'es']::text[]
      and array_length(caller_languages, 1) >= 1
    ),
  add column if not exists notification_channel text not null default 'sms'
    check (notification_channel in ('sms', 'whatsapp', 'both')),
  add column if not exists owner_notify_e164 text,
  add column if not exists whatsapp_last_inbound_at timestamptz;

comment on column public.organizations.vertical is
  'Multi-vertical Phase 1: business vertical driving Layla terminology, prompt fragment, intake questions, and PHI scrubbing. Default medspa preserves current behavior. Source of truth: src/lib/vertical/config.ts.';

comment on column public.organizations.owner_language is
  'Multi-vertical Phase 1: language for OWNER-facing output (call summaries, notifications) ONLY. Default en. Independent of caller_languages — an English-speaking owner can run a bilingual EN+ES caller line.';

comment on column public.organizations.caller_languages is
  'Multi-vertical Phase 1: languages the assistant must handle on calls → drives the Deepgram transcriber model, the TTS voice, and the bilingual directive. Default {en} = English-only (unchanged). {en,es} = bilingual line (English-owner/Spanish-customer shops are a core segment). Source of truth: resolveCallerLanguages() in src/lib/vertical/config.ts.';

comment on column public.organizations.notification_channel is
  'Multi-vertical Phase 1: owner alert push channel. Default sms. WhatsApp requires WHATSAPP_ENABLED + owner_notify_e164; any WhatsApp failure falls back to SMS. Additive to the existing email alerts, which continue regardless.';

comment on column public.organizations.owner_notify_e164 is
  'Multi-vertical Phase 1: owner mobile in E.164 for SMS/WhatsApp owner alerts. NULL leaves SMS/WA push inert (email alerts still fire).';

comment on column public.organizations.whatsapp_last_inbound_at is
  'Multi-vertical Phase 3: timestamp of the owner''s most recent inbound WhatsApp message, stamped by the Twilio WhatsApp webhook. Inside 24h → freeform WhatsApp allowed; outside → pre-approved template only. Org-level, assumes a single owner WhatsApp number.';

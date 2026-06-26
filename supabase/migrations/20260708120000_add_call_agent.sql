-- Phase 5 W1 — Voice Phone Twin foundation.
--
-- Adds:
--   1. call_logs table — one row per inbound call. Mirrors the
--      messages/sms_log audit pattern. Transcript stored as plain
--      jsonb (TODO: encrypt at rest when Phase 0 PHI-encryption push
--      lands; until then, parity with messages.body which is also
--      plaintext).
--   2. contacts.voice_recording_consent + _at — captured verbally on
--      the call ("this call may be recorded — do you consent?") or
--      via the public /voice-consent page. Mirrors sms_consent.
--   3. organizations.call_agent_* — per-org config for the voice twin:
--      enabled toggle, mode (off | after_hours | always), fallback
--      number (where to transfer if mode=after_hours during business
--      hours OR if safety-handoff fires), business hours jsonb,
--      greeting copy, the Vapi assistant id we pushed for this org,
--      and the BAA attestation timestamp.
--
-- Naming: every new column / table is namespaced `call_*`. The
-- existing `voice_*` surface (voice_profile, voice_examples,
-- voice_health, allowsVoiceTraining) refers to SMS-tone, NOT literal
-- phone audio — the pricing page already uses that branding.
-- Mixing the two would break the customer mental model.
--
-- Compliance gate: organizations.call_agent_enabled MUST NOT be
-- toggled true via the API until call_agent_baa_attested_at IS NOT
-- NULL. The API enforces this in /settings/call-agent; we don't add
-- a CHECK constraint here because the attestation is operational
-- (owner clicked "BAA in hand"), not a data invariant.

-- ── 1. call_logs ───────────────────────────────────────────────
create table if not exists public.call_logs (
  id                          uuid        primary key default gen_random_uuid(),
  organization_id             uuid        not null references public.organizations(id) on delete cascade,
  contact_id                  uuid        references public.contacts(id) on delete set null,
  -- Twilio CallSid is globally unique; index unique to dedup status-
  -- callback retries.
  call_sid                    text        not null unique,
  from_e164                   text        not null,  -- caller (E.164)
  to_e164                     text        not null,  -- clinic number (E.164)
  direction                   text        not null check (direction in ('inbound', 'outbound')),
  started_at                  timestamptz not null default now(),
  ended_at                    timestamptz,
  duration_sec                integer,
  -- Inferred intent from the call (faq, book, message, safety,
  -- unknown). Lets the timeline UI badge calls without re-parsing
  -- the transcript.
  intent                      text,
  -- Free-form transcript payload from Vapi. JSON shape varies; we
  -- don't enforce a schema at the DB layer — the persistence helper
  -- normalizes before insert.
  transcript                  jsonb,
  -- Vapi/Twilio recording URL. We never proxy or download; on owner
  -- replay the client fetches directly. Cleared if recording_consent
  -- was refused or the call hit safety handoff.
  recording_url               text,
  recording_consent_obtained  boolean     not null default false,
  -- If a safetyTrigger matched mid-call, store the label so the
  -- dashboard alert can categorize. NULL when no trigger fired.
  safety_trigger_label        text,
  outcome                     text        not null default 'completed'
    check (outcome in (
      'completed',         -- normal call end
      'transferred',       -- bridged to fallback_e164
      'voicemail',         -- caller left a message
      'safety_handoff',    -- safetyTrigger fired, terminal
      'no_consent',        -- caller refused recording, call ended
      'agent_error'        -- Vapi crashed, Twilio failover or hangup
    )),
  -- Free-form follow-up the owner needs to action. NOT shown to the
  -- patient; lands in the timeline as an internal note. Useful for
  -- the voicemail outcome.
  followup_summary            text,
  created_at                  timestamptz not null default now()
);

create index if not exists call_logs_org_started_idx
  on public.call_logs(organization_id, started_at desc);
create index if not exists call_logs_contact_idx
  on public.call_logs(contact_id, started_at desc)
  where contact_id is not null;

alter table public.call_logs enable row level security;

do $call_logs_rls$
begin
  drop policy if exists call_logs_org_isolation on public.call_logs;
  create policy call_logs_org_isolation
    on public.call_logs
    for all
    using (
      organization_id in (
        select organization_id from public.profiles
        where id = auth.uid()
          and is_active = true
      )
    )
    with check (
      organization_id in (
        select organization_id from public.profiles
        where id = auth.uid()
          and is_active = true
      )
    );
end
$call_logs_rls$;

comment on table public.call_logs is
  'Phase 5 W1: one row per voice call. Mirrors sms_log shape. Transcript stored as jsonb (plaintext for V1; revisit when Phase 0 PHI-encryption push lands).';

-- ── 2. contacts.voice_recording_consent ────────────────────────
-- Mirrors the sms_consent + sms_consent_at columns added in W8.
-- Captured (a) verbally during the call ("may I record this call?"
-- yes) and persisted by the call-end webhook, or (b) via the public
-- /voice-consent page if the clinic shares it ahead of time.
alter table public.contacts
  add column if not exists voice_recording_consent    boolean,
  add column if not exists voice_recording_consent_at timestamptz;

comment on column public.contacts.voice_recording_consent is
  'Phase 5 W1: did this contact consent to having voice calls recorded? Captured verbally or via /voice-consent.';

-- ── 3. organizations.call_agent_* ──────────────────────────────
alter table public.organizations
  add column if not exists call_agent_enabled         boolean     not null default false,
  add column if not exists call_agent_mode            text        not null default 'off'
    check (call_agent_mode in ('off', 'after_hours', 'always')),
  add column if not exists call_agent_fallback_e164   text,
  -- Weekly business hours, same shape as availability_rules but
  -- stored as a single jsonb blob keyed by weekday (0=Sun..6=Sat).
  -- Owners edit via /settings/call-agent. When mode=after_hours,
  -- the voice webhook checks the current clinic-local time against
  -- these and routes to the AI agent only outside open hours.
  add column if not exists call_agent_business_hours  jsonb,
  add column if not exists call_agent_greeting        text,
  -- Vapi assistant id we created for this org via the management
  -- API. Lets us route the inbound call to the right Vapi config
  -- with the right tools + prompt loaded.
  add column if not exists call_agent_assistant_id    text,
  -- Vapi voice id (shared one neutral voice for V1; custom voice
  -- cloning deferred to a paid add-on later).
  add column if not exists call_agent_voice_id        text,
  -- BAA attestation timestamp. The owner clicks "I have a BAA on
  -- file with Vapi" — this is the gate that lets call_agent_enabled
  -- flip true. Operational attestation, not legal substitute for the
  -- BAA itself.
  add column if not exists call_agent_baa_attested_at timestamptz;

comment on column public.organizations.call_agent_baa_attested_at is
  'Phase 5 W1: HIPAA compliance gate. Owner attests they have a BAA with Vapi (and Vapi has flowed it down to OpenAI/Deepgram/ElevenLabs). API refuses to enable call_agent unless this is set.';

comment on column public.organizations.call_agent_business_hours is
  'Phase 5 W1: { "0": [{"start":"09:00","end":"17:00"}], ... } keyed by weekday (0=Sun..6=Sat). Empty array = closed that day.';

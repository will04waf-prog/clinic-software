-- ──────────────────────────────────────────────────────────────────
-- Phase 5 W2 — outbound AI reminder calls.
--
-- Adds per-consultation voice-reminder lifecycle state and per-org
-- enable + lead-time knobs. Separate from the existing
-- reminder_24h_sent / reminder_2h_sent SMS-and-email booleans so a
-- patient can independently receive a voice reminder, an SMS
-- reminder, and an email reminder without one channel's success
-- (or failure) silently suppressing another.
--
-- Why a status enum (not another _sent boolean):
--   The voice reminder has more outcomes than "sent / not sent" —
--   the bot can confirm, the bot can reschedule live, the bot can
--   cancel live, the patient can decline, the call can hit
--   voicemail, the patient may not answer at all. We want the cron
--   loop to be able to encode all of those in a single column so
--   the operator can answer "what happened to this reminder?" with
--   a SELECT, and so the end-of-call webhook can patch the row to
--   the final disposition without colliding with the cron's
--   pending → sent transition.
--
-- Why a per-org lead_hours column (not just 24h hard-coded):
--   Some clinics will prefer 48h lead time for high-cost
--   procedures; others want a 2-3h "are you still coming?" nudge.
--   The CHECK clamps to 2..72 so the cron's window math
--   (lead_hours ± 30min around scheduled_at) doesn't degenerate
--   into "every consultation in the next year" if a typo lands.
-- ──────────────────────────────────────────────────────────────────

-- ── consultations: voice-reminder lifecycle ──
-- DEFAULT 'pending' so existing rows backfill cleanly. The cron's
-- gate is .eq('voice_reminder_status','pending') so every row
-- automatically becomes eligible on the next tick after install
-- regardless of when it was originally booked — no separate
-- backfill needed.
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS voice_reminder_status  text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS voice_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS voice_reminder_call_sid text;

-- Enum constraint added separately so we can DROP+ADD on idempotent
-- re-run. The set mirrors the dispositions the reminder bot can
-- emit through its post_call_summary_email tool plus the cron's
-- own pre-call states (pending → sent → terminal).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultations_voice_reminder_status_check'
  ) THEN
    ALTER TABLE consultations
      ADD CONSTRAINT consultations_voice_reminder_status_check
      CHECK (voice_reminder_status IN (
        'pending',       -- cron has not yet attempted a call
        'sent',          -- outbound call placed; awaiting end-of-call disposition
        'confirmed',     -- patient confirmed live via confirm_appointment
        'rescheduled',   -- patient rescheduled live
        'canceled',      -- patient canceled live
        'no_answer',     -- no pickup
        'voicemail',     -- went to voicemail
        'declined',      -- patient picked up but refused engagement
        'skipped'        -- gating failure (no phone / opted out / no assistant)
      ));
  END IF;
END$$;

-- Cron window query needs (status, voice_reminder_status,
-- scheduled_at) and the SMS-reminder query already has
-- consultations_scheduled_idx — but the SMS query gates on
-- reminder_24h_sent=false while this one gates on
-- voice_reminder_status='pending'. Partial index over the eligible
-- rows keeps the planner from sequential-scanning a fully-resolved
-- consultations table once we've been running a while.
CREATE INDEX IF NOT EXISTS consultations_voice_reminder_pending_idx
  ON consultations (organization_id, scheduled_at)
  WHERE voice_reminder_status = 'pending'
    AND status IN ('scheduled', 'confirmed');

-- ── organizations: outbound-reminder feature knobs ──
-- voice_reminder_enabled defaults FALSE because outbound automated
-- calls are TCPA-sensitive and we don't want existing orgs to
-- start robocalling patients on the next deploy without an
-- explicit opt-in. The settings card sets it true after the owner
-- toggles the new "Send AI reminder calls" switch.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS voice_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_reminder_lead_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS call_agent_reminder_assistant_id text;

-- Clamp lead_hours to a sane range. The cron uses ±30min, so the
-- lower bound has to be > 0.5h or the window straddles "now" and
-- the next tick will retry the same consultation. Upper bound of
-- 72h covers "remind two days before a big visit" without letting
-- a typo turn the cron into a full-week table scan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_voice_reminder_lead_hours_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_voice_reminder_lead_hours_check
      CHECK (voice_reminder_lead_hours BETWEEN 2 AND 72);
  END IF;
END$$;

COMMENT ON COLUMN consultations.voice_reminder_status IS
  'Lifecycle of the outbound AI reminder call. pending → sent → terminal disposition (confirmed/rescheduled/canceled/no_answer/voicemail/declined). Channel-independent of reminder_24h_sent / reminder_2h_sent.';

COMMENT ON COLUMN consultations.voice_reminder_call_sid IS
  'Vapi call id (NOT a Twilio CallSid) for the outbound reminder call. Correlates the call-end webhook back to this consultation.';

COMMENT ON COLUMN organizations.voice_reminder_enabled IS
  'Master toggle for outbound AI reminder calls. False by default — opt-in only because outbound automated calls are TCPA-sensitive.';

COMMENT ON COLUMN organizations.voice_reminder_lead_hours IS
  'Hours before scheduled_at to attempt the reminder call. Cron uses lead_hours ± 30min as the eligibility window. Clamped to [2,72].';

COMMENT ON COLUMN organizations.call_agent_reminder_assistant_id IS
  'Vapi assistant id for the reminder-specific bot (separate from call_agent_assistant_id which is the inbound receptionist). Stamped by scripts/seed-vapi-reminder-assistant.ts.';

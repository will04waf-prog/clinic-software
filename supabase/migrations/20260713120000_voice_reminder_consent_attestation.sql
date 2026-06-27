-- Phase 5 W2 — TCPA voice-consent attestation.
--
-- The W2 outbound reminder cron approximates voice consent via
-- contact.opted_out_sms (a STOP-keyword signal on the SMS channel).
-- Legally that's NOT equivalent to "prior express consent for
-- automated outbound calls" under TCPA §227(b)(1)(A) — SMS STOP and
-- robocall consent are distinct surfaces.
--
-- Short-term mitigation: require an owner attestation that they
-- collected prior express consent at intake before enabling the
-- reminder toggle. The attestation is a timestamp column on
-- organizations, mirroring how call_agent_baa_attested_at works for
-- the inbound HIPAA gate. The PATCH handler on /api/org/call-agent
-- refuses to flip voice_reminder_enabled to true unless this column
-- IS NOT NULL.
--
-- Long-term: a dedicated contacts.opted_out_voice column + a
-- voice STOP-keyword handler on the inbound side. That's tracked
-- as a follow-up; this column buys us a compliant launch in the
-- meantime.

alter table public.organizations
  add column if not exists voice_reminder_consent_attested_at timestamptz;

comment on column public.organizations.voice_reminder_consent_attested_at is
  'Phase 5 W2: owner attestation that they have prior express consent from their patients to place automated outbound reminder calls. Required before voice_reminder_enabled can be flipped true. Set to now() when the owner checks the attestation box in /settings/call-agent.';

-- Idempotency dedup safety net for the automation-engine email path.
--
-- Today, the find-or-insert pattern in processEnrollmentStep is already
-- race-safe because withCronLock('processDueSteps', 90, ...) serializes
-- the cron tick — only one worker reads-then-inserts the 'queued' row
-- at a time. This index does NOT change behavior under the current
-- lock wrapper.
--
-- It exists pre-emptively for PR-FU-1 (atomic-claim refactor of
-- processDueSteps), which will remove the coarse-grained cron lock.
-- Once removed, two concurrent ticks could both SELECT no row and both
-- INSERT a 'queued' messages row for the same (sequence_step_id,
-- contact_id) — generating two distinct messages.id values, two distinct
-- Resend Idempotency-Key values, and a double email.
--
-- The partial predicate is narrow on purpose:
--   * status='queued'         — once a row transitions to sent/failed,
--                                this index releases its slot, so a
--                                future unrelated send for the same
--                                (step, contact) is unaffected
--   * channel='email'          — SMS has no idempotency story yet
--                                (Twilio Messaging API doesn't expose
--                                Idempotency-Key); revisit in PR-FU-1
--   * direction='outbound'     — inbound rows (webhook ingest) are not
--                                constrained
--   * sequence_step_id IS NOT  — manual sends (leads/[id]/send-email,
--     NULL                       demo notifications) carry NULL here
--                                and are intentionally excluded from
--                                the constraint
--
-- Index name keeps the predicate visible at the catalog level.

begin;

create unique index if not exists messages_queued_step_contact_email_idx
  on public.messages (sequence_step_id, contact_id)
  where status = 'queued'
    and channel = 'email'
    and direction = 'outbound'
    and sequence_step_id is not null;

commit;

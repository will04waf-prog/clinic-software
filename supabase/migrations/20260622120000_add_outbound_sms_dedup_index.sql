-- ============================================================
-- Partial unique index preventing duplicate outbound SMS for the
-- same automation step + contact.
--
-- The email branch of processEnrollmentStep already has a similar
-- partial unique index (messages_queued_step_contact_email_idx) and
-- uses insert-then-send so concurrent runs collide on the index
-- instead of dispatching twice. The SMS branch had no such guard,
-- which let the shadow-mode race (legacy in-process enrollContact
-- vs cron-drained queue) actually send a customer the same SMS
-- twice.
--
-- The default ENROLLMENT_JOBS_MODE is now 'primary' (queue-only) so
-- this race shouldn't happen in normal operation. This index is
-- defense-in-depth: if a retry storm or a future bug ever schedules
-- the same (sequence_step_id, contact_id) twice, the second insert
-- fails with a 23505 unique violation and the SMS isn't sent again.
--
-- Partial filter limits the index to outbound SMS so it doesn't
-- collide with inbound replies or with future direct/manual sends
-- that legitimately may not have a sequence_step_id.
-- ============================================================

create unique index if not exists messages_step_contact_sms_dedup_idx
  on public.messages (sequence_step_id, contact_id)
  where channel = 'sms'
    and direction = 'outbound'
    and sequence_step_id is not null;

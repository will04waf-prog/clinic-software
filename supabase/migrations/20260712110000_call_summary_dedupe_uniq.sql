-- Phase 5 hardening — owner-notification dedupe race close-out.
--
-- Background: notifyOwnerOfCallSummary and notifyOwnerOfVoiceMessage
-- both implement "have we already emailed this owner?" via a
-- SELECT-then-INSERT on activity_log:
--
--   1) SELECT id FROM activity_log WHERE action=$ACTION
--        AND metadata @> jsonb_build_object('call_sid', $sid);
--   2) if no row, send email + INSERT a dedupe row.
--
-- That is a classic check-then-act race. Two near-simultaneous
-- tool-call retries (Vapi retries on the post-call-summary-email
-- handler, or our own retry-on-500 from voice/call-end) can both
-- run step 1, both miss, and both send the owner email + both
-- INSERT a dedupe row. The Resend Idempotency-Key catches the
-- email duplication in practice (24h window) but the activity_log
-- still ends up with two "owner_notified_*" rows, which corrupts
-- the audit trail and the same dedupe surface for ANY follow-up
-- read of the table.
--
-- Fix: push dedupe into the database with a partial UNIQUE index
-- keyed on (organization_id, metadata->>'call_sid') (and the
-- voice_message_id analog), scoped by action. Then the helpers
-- swap the SELECT-then-INSERT for an INSERT-then-handle-23505:
--
--   - INSERT first, only send the email if the insert succeeds
--     (the row is the "we won the race" claim ticket).
--   - On 23505 (unique_violation), the other side won — no-op.
--
-- This means the Resend send is ALSO inside the won-race branch,
-- so we no longer rely on Resend's idempotencyKey as the primary
-- dedupe. The idempotencyKey stays as belt-and-suspenders.
--
-- Each CREATE INDEX is on a single line so the Supabase SQL editor's
-- parser cannot split a multi-line WHERE clause on whitespace.

-- Pre-deploy de-dup. The SELECT-then-INSERT race could have already
-- written duplicate rows; if so, CREATE UNIQUE INDEX fails with 23505
-- and blocks the migration chain. Keep the earliest row per dedupe
-- key (the one that actually sent the email).
delete from public.activity_log a using public.activity_log b
where a.action = 'owner_notified_call_summary' and b.action = 'owner_notified_call_summary'
  and a.organization_id = b.organization_id
  and (a.metadata->>'call_sid') = (b.metadata->>'call_sid')
  and a.created_at > b.created_at;

delete from public.activity_log a using public.activity_log b
where a.action = 'owner_notified_voice_message' and b.action = 'owner_notified_voice_message'
  and a.organization_id = b.organization_id
  and (a.metadata->>'voice_message_id') = (b.metadata->>'voice_message_id')
  and a.created_at > b.created_at;

create unique index if not exists activity_log_call_summary_uniq on public.activity_log (organization_id, (metadata->>'call_sid')) where action = 'owner_notified_call_summary';

create unique index if not exists activity_log_voice_message_notify_uniq on public.activity_log (organization_id, (metadata->>'voice_message_id')) where action = 'owner_notified_voice_message';

comment on index public.activity_log_call_summary_uniq is 'Phase 5 — dedupe-race close-out for notifyOwnerOfCallSummary. INSERT first, treat 23505 as already-sent no-op.';

comment on index public.activity_log_voice_message_notify_uniq is 'Phase 5 — dedupe-race close-out for notifyOwnerOfVoiceMessage. INSERT first, treat 23505 as already-sent no-op.';

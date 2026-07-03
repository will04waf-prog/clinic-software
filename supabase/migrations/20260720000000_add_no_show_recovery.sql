-- ────────────────────────────────────────────────────────────────
-- No-show recovery: one-message-per-no-show tracking column.
--
-- The recovery sweep (src/lib/no-show-recovery.ts, run from the
-- every-minute cron) CAS-claims this column before sending the
-- rebooking nudge, so a no-show can never be messaged twice.
--
-- Backfill: rows that are ALREADY no_show when this feature ships
-- get stamped with now() so the sweep never messages patients about
-- appointments missed before the feature existed.
-- ────────────────────────────────────────────────────────────────

alter table public.consultations
  add column if not exists no_show_recovery_sent_at timestamptz;

update public.consultations
  set no_show_recovery_sent_at = now()
  where status = 'no_show'
    and no_show_recovery_sent_at is null;

-- The sweep's hot query: status='no_show' AND recovery IS NULL in a
-- recent window. Partial index keeps it O(pending recoveries).
create index if not exists consultations_no_show_recovery_idx
  on public.consultations (updated_at)
  where status = 'no_show' and no_show_recovery_sent_at is null;

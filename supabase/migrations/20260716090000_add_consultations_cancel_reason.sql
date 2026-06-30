-- ─────────────────────────────────────────────────────────────────────
-- Add the missing consultations.cancel_reason column.
--
-- The booking-foundation work (20260701120000) and the hold-expiry
-- sweep (src/lib/booking/expire-holds.ts) were written assuming a
-- cancel_reason column exists — the sweep flips an expired hold to
-- status='canceled' with cancel_reason='hold_expired' to preserve the
-- audit trail. But the column was never actually created in any
-- migration, so the cron has been failing every minute in production:
--   "Could not find the 'cancel_reason' column of 'consultations'"
-- (6,300+ occurrences). With the column absent the sweep aborts, so
-- expired holds are never released and their slots stay locked.
--
-- Nullable free-form text: the only writer today sets 'hold_expired',
-- but other cancel paths (public booking cancel, AI Twin) may set their
-- own reasons later, so we don't pin a CHECK constraint yet. No backfill
-- needed — historical canceled rows simply have a null reason.
--
-- Additive + IF NOT EXISTS => safe to re-apply; nullable text add is a
-- metadata-only operation (no table rewrite).
-- ─────────────────────────────────────────────────────────────────────

alter table public.consultations
  add column if not exists cancel_reason text;

comment on column public.consultations.cancel_reason is
  'Why a consultation was canceled. Set to ''hold_expired'' by the booking_hold_sweep cron (src/lib/booking/expire-holds.ts); null for rows canceled by other paths. Free-form for now.';

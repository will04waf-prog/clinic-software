-- ────────────────────────────────────────────────────────────────
-- Weekly "Layla's impact" digest — org-level opt-out + send claim.
--
-- weekly_digest_enabled      owner-level opt-out (default ON; the
--                            digest footer offers reply-to-disable,
--                            the operator flips this column; a
--                            Settings toggle is a UI follow-up).
-- weekly_digest_last_sent_at CAS-claim column: the Monday cron only
--                            sends when NULL or older than 6 days,
--                            claimed atomically per org — the same
--                            exactly-once pattern as the
--                            trial_reminder_*_sent_at columns.
--
-- DDL only — no rows modified.
-- ────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists weekly_digest_enabled boolean not null default true,
  add column if not exists weekly_digest_last_sent_at timestamptz;

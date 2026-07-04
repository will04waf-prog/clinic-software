-- ────────────────────────────────────────────────────────────────
-- Dunning + win-back: churn timestamps and one-shot win-back claims.
--
--   canceled_at            stamped by the subscription.deleted webhook;
--                          the churn win-back sweep fires 14d after it.
--   winback_sent_at        CAS claim — one churn win-back per cancellation
--                          (cleared on resubscribe so a future churn can
--                          win-back again).
--   trial_winback_sent_at  CAS claim — one trial win-back per org,
--                          7d after trial_expired.
--
-- Backfill: any org ALREADY in trial_expired/canceled when this ships
-- gets its claim stamped, so the new sweep never blasts historical
-- churn from before the feature existed. (Zero such rows today —
-- defensive.)
-- ────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists canceled_at            timestamptz,
  add column if not exists winback_sent_at        timestamptz,
  add column if not exists trial_winback_sent_at  timestamptz;

update public.organizations
  set trial_winback_sent_at = now()
  where plan_status = 'trial_expired' and trial_winback_sent_at is null;

update public.organizations
  set canceled_at = coalesce(canceled_at, now()),
      winback_sent_at = now()
  where plan_status = 'canceled' and winback_sent_at is null;

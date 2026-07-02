-- ────────────────────────────────────────────────────────────────
-- Arm the trial lifecycle: new organizations default to
-- plan_status='trial'.
--
-- Context: 001_initial_schema.sql defaulted plan to 'trial' but
-- plan_status to 'active', and the signup route never set plan_status
-- — so every self-serve signup skipped the entire trial machinery
-- (trial banner, 7/3/1-day reminder emails, expire-trials cron, proxy
-- lockout, and the Scale-equivalent-during-trial rule in org-tier.ts)
-- and sat on un-expiring Professional-tier access.
--
-- The signup route now sets plan/plan_status explicitly; this default
-- change is defense-in-depth so any future org-creation path starts
-- life as a trial rather than as a paying-looking 'active' org.
--
-- DDL only — no rows are modified. The backfill for pre-existing
-- stuck orgs is a separate, explicitly-confirmed operation.
-- ────────────────────────────────────────────────────────────────

alter table public.organizations
  alter column plan_status set default 'trial';

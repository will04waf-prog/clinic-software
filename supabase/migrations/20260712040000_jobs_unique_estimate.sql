-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first.
--
-- CRM pivot P2 hardening: at most one job per estimate. NULLs stay
-- distinct (Postgres default), so jobs created directly without an
-- estimate are unaffected. This lets the public approve flow upsert the
-- follow-on job idempotently (on-conflict-do-nothing) and self-heal a
-- job whose insert failed after the approval flip — closing the
-- lost-job durability gap the security review flagged.
create unique index if not exists jobs_estimate_id_key on public.jobs (estimate_id);

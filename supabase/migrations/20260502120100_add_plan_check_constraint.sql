-- Add CHECK constraint on organizations.plan to enforce valid tier values.
-- 'pro' is retained as a valid value for backward compat with the single
-- existing row that has plan='pro'. To be migrated to 'professional' and
-- removed from this allowlist in a follow-up PR.
--
-- Pre-flight check (run before applying):
--   select distinct plan from organizations;
--   expected: only values within the allowlist below
-- Production state at time of writing: plan in ('trial', 'pro')

begin;

alter table organizations
  add constraint organizations_plan_check
  check (plan in ('trial', 'starter', 'professional', 'scale', 'pro', 'canceled'));

commit;

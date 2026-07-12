-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first per the standing rule.
--
-- CRM pivot, migration E: allow organizations.vertical = 'landscaping'.
-- Landscaping is the first deep-built vertical of the CRM pivot (its own
-- vertical, not squatting on 'trades'). Strict superset of the existing
-- allowed values, so every legacy row stays valid — additive, no data
-- migration. Validated on staging (landscaping inserts, a bogus value is
-- rejected, legacy medspa/trades rows unaffected) before prod.

alter table public.organizations drop constraint organizations_vertical_check;
alter table public.organizations add constraint organizations_vertical_check
  check (vertical = any (array['medspa'::text,'trades'::text,'food'::text,'general'::text,'landscaping'::text]));

-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first per the standing rule.
--
-- CRM pivot P1: vertical-aware pipeline-stage seeding. Landscaping (and
-- future service verticals) get Spanish, loop-oriented stages; med-spa
-- and everything else delegate to the legacy seed_default_stages, which
-- is left completely untouched (the 10 med-spa orgs are unaffected).
-- Additive: creates a new function only. Validated on staging —
-- landscaping seeds 7 Spanish stages, medspa delegates to the English seed.

create or replace function public.seed_stages_for_vertical(org_id uuid, p_vertical text default 'medspa')
returns void
language plpgsql
as $$
begin
  if p_vertical = 'landscaping' then
    insert into pipeline_stages (organization_id, name, color, position, is_default)
    values
      (org_id, 'Nuevo cliente',        '#64748b', 0, true),
      (org_id, 'Presupuesto enviado',  '#028090', 1, false),
      (org_id, 'Aprobado',             '#02c39a', 2, false),
      (org_id, 'Programado',           '#f59e0b', 3, false),
      (org_id, 'Completado',           '#3b82f6', 4, false),
      (org_id, 'Pagado',               '#22c55e', 5, false),
      (org_id, 'Perdido',              '#ef4444', 6, false);
  else
    perform seed_default_stages(org_id);
  end if;
end;
$$;

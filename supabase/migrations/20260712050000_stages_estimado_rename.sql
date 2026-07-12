-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first.
--
-- Standardize the loop's Spanish noun on 'estimado' (founder decision):
-- rename the landscaping pipeline stage 'Presupuesto enviado' →
-- 'Estimado enviado'. create-or-replace; no data backfill needed (no
-- real landscaping orgs exist yet — the seed only runs for future signups).

create or replace function public.seed_stages_for_vertical(org_id uuid, p_vertical text default 'medspa')
returns void language plpgsql as $$
begin
  if p_vertical = 'landscaping' then
    insert into pipeline_stages (organization_id, name, color, position, is_default)
    values
      (org_id, 'Nuevo cliente',      '#64748b', 0, true),
      (org_id, 'Estimado enviado',   '#028090', 1, false),
      (org_id, 'Aprobado',           '#02c39a', 2, false),
      (org_id, 'Programado',         '#f59e0b', 3, false),
      (org_id, 'Completado',         '#3b82f6', 4, false),
      (org_id, 'Pagado',             '#22c55e', 5, false),
      (org_id, 'Perdido',            '#ef4444', 6, false);
  else
    perform seed_default_stages(org_id);
  end if;
end;
$$;

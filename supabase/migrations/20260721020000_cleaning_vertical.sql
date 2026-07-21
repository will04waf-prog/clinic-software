-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-21, staging-first.
--
-- Industry ladder step 2: the 'cleaning' vertical (residential
-- limpieza). Extends the vertical CHECK and widens the stage seeding
-- to the loop FAMILY so cleaning signups get the Spanish estimado
-- pipeline instead of the legacy English clinic stages.
alter table public.organizations drop constraint organizations_vertical_check;
alter table public.organizations add constraint organizations_vertical_check
  check (vertical in ('medspa','trades','food','general','landscaping','cleaning'));

create or replace function public.seed_stages_for_vertical(org_id uuid, p_vertical text default 'medspa')
returns void language plpgsql as $$
begin
  -- Loop FAMILY, not a single vertical (2026-07-12 P0 lesson): every
  -- loop signup gets the Spanish estimado pipeline.
  if p_vertical in ('landscaping', 'cleaning', 'trades') then
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

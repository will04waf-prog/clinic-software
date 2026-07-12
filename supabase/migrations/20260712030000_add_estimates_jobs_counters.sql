-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first per the standing rule.
--
-- CRM pivot P2 — the loop's data spine: estimates → line items → jobs,
-- plus per-org document numbering. Additive; modern RLS generation
-- (inline profiles org lookup + WITH CHECK). The public estimate/invoice
-- pages read via SERVICE-ROLE by signed token, NOT anon RLS — so there is
-- no anon policy, and the trailing REVOKE strips anon's default grants
-- (defense-in-depth, per the organizations anon-leak lesson). Validated
-- on staging: numbering increments per org, estimate + line items + job
-- insert all succeed; RLS on all four tables; anon has no grants.

create table if not exists public.org_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('estimate','invoice')),
  next_val        int  not null default 1,
  primary key (organization_id, kind)
);
alter table public.org_counters enable row level security;
create policy org_counters_org_isolation on public.org_counters
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.org_counters to authenticated, service_role;

-- Atomically assign the next sequential number for (org, kind), from 1.
create or replace function public.next_document_number(p_org uuid, p_kind text)
returns int language sql security definer set search_path to 'public'
as $$
  insert into public.org_counters as c (organization_id, kind, next_val)
  values (p_org, p_kind, 2)
  on conflict (organization_id, kind) do update set next_val = c.next_val + 1
  returning c.next_val - 1;
$$;

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  estimate_number int not null,
  status text not null default 'draft' check (status in ('draft','sent','viewed','approved','expired','void')),
  title text, notes text,
  subtotal_cents int not null default 0 check (subtotal_cents >= 0),
  tax_cents int not null default 0 check (tax_cents >= 0),
  total_cents int not null default 0 check (total_cents >= 0),
  currency text not null default 'usd',
  -- Immutable approval proof, written server-side from the public link.
  approved_at timestamptz, approved_ip text, sent_at timestamptz, viewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, estimate_number)
);
create index if not exists estimates_org_idx on public.estimates(organization_id);
create index if not exists estimates_contact_idx on public.estimates(contact_id);
alter table public.estimates enable row level security;
create policy estimates_org_isolation on public.estimates
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.estimates to authenticated, service_role;
create trigger set_updated_at before update on public.estimates for each row execute function set_updated_at();

create table if not exists public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_cents int not null default 0 check (unit_price_cents >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists estimate_line_items_estimate_idx on public.estimate_line_items(estimate_id);
alter table public.estimate_line_items enable row level security;
create policy estimate_line_items_org_isolation on public.estimate_line_items
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.estimate_line_items to authenticated, service_role;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid references public.estimates(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  title text,
  scheduled_date date,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','canceled')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_org_idx on public.jobs(organization_id);
create index if not exists jobs_scheduled_idx on public.jobs(organization_id, scheduled_date);
alter table public.jobs enable row level security;
create policy jobs_org_isolation on public.jobs
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.jobs to authenticated, service_role;
create trigger set_updated_at before update on public.jobs for each row execute function set_updated_at();

-- Defense-in-depth: strip anon's default grants (public pages use service-role).
revoke all on public.estimates from anon;
revoke all on public.estimate_line_items from anon;
revoke all on public.jobs from anon;
revoke all on public.org_counters from anon;

-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb) on 2026-07-12, staging-first.
--
-- CRM pivot P3 — the money spine: invoices → line items → payments +
-- Stripe Connect Express columns on organizations. Additive; modern RLS
-- (inline org lookup + WITH CHECK); anon grants revoked (public pay page
-- reads via service-role + signed token, never anon). payments is an
-- APPEND-ONLY ledger: authenticated may only SELECT (grants + policy);
-- all writes (client card payments, manual cash/Zelle marks) go through
-- service-role. Validated on staging: invoice → line items → card payment
-- with application fee, per-org numbering, RLS on all three, anon locked
-- out. Legacy tables + 10 med-spa orgs untouched.

alter table public.organizations
  add column if not exists stripe_connect_id text,
  add column if not exists connect_charges_enabled boolean not null default false,
  add column if not exists connect_payouts_enabled boolean not null default false,
  add column if not exists connect_onboarded_at timestamptz;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  invoice_number int not null,
  status text not null default 'draft' check (status in ('draft','sent','paid','void')),
  title text, notes text,
  subtotal_cents int not null default 0 check (subtotal_cents >= 0),
  tax_cents int not null default 0 check (tax_cents >= 0),
  total_cents int not null default 0 check (total_cents >= 0),
  amount_paid_cents int not null default 0 check (amount_paid_cents >= 0),
  currency text not null default 'usd',
  sent_at timestamptz, paid_at timestamptz, viewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);
create index if not exists invoices_org_idx on public.invoices(organization_id);
create index if not exists invoices_contact_idx on public.invoices(contact_id);
alter table public.invoices enable row level security;
create policy invoices_org_isolation on public.invoices
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.invoices to authenticated, service_role;
create trigger set_updated_at before update on public.invoices for each row execute function set_updated_at();

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_cents int not null default 0 check (unit_price_cents >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists invoice_line_items_invoice_idx on public.invoice_line_items(invoice_id);
alter table public.invoice_line_items enable row level security;
create policy invoice_line_items_org_isolation on public.invoice_line_items
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.invoice_line_items to authenticated, service_role;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('card','cash','zelle','check','other')),
  status text not null default 'succeeded' check (status in ('pending','succeeded','failed','refunded')),
  stripe_payment_intent text,
  application_fee_cents int check (application_fee_cents is null or application_fee_cents >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_org_idx on public.payments(organization_id);
create index if not exists payments_invoice_idx on public.payments(invoice_id);
alter table public.payments enable row level security;
create policy payments_org_read on public.payments
  for select
  using (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

-- Defense-in-depth: anon locked out everywhere; payments append-only for
-- authenticated (read-only at the grant level, not just via RLS).
revoke all on public.invoices from anon;
revoke all on public.invoice_line_items from anon;
revoke all on public.payments from anon;
revoke insert, update, delete, truncate on public.payments from authenticated;

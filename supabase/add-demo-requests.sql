-- Demo requests table for tracking book-a-demo submissions
create table public.demo_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  clinic_name  text not null,
  email        text not null,
  phone        text,
  preferred_date text,
  notes        text,
  status       text not null default 'new' check (status in ('new', 'booked', 'completed', 'cancelled')),
  source       text,
  page_path    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- RLS: only service role can read/write (public insert via service role API route)
alter table public.demo_requests enable row level security;

-- No public policies — all access goes through service role in API routes

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger demo_requests_updated_at
  before update on public.demo_requests
  for each row execute function public.set_updated_at();

-- Index for admin list queries
create index demo_requests_status_created_at on public.demo_requests (status, created_at desc);

-- Personalized prospect demos: each row is one clinic we spun a
-- private "hear Layla answer YOUR phone" demo for. Marketing data
-- only — no patient data, no org linkage. Service-role access only
-- (RLS on, zero policies = deny for anon/authenticated).
create table if not exists demo_prospects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  clinic_name text not null,
  city text,
  address text,
  services text[],
  website text,
  vapi_assistant_id text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table demo_prospects enable row level security;

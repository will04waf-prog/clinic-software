-- ── SMS consent on contacts ────────────────────────────────────
alter table public.contacts
  add column if not exists sms_consent boolean not null default false;

-- ── Per-clinic SMS settings on organizations ───────────────────
alter table public.organizations
  add column if not exists sms_enabled               boolean not null default false,
  add column if not exists sms_confirmation_enabled  boolean not null default true,
  add column if not exists sms_reminder_24h_enabled  boolean not null default true,
  add column if not exists sms_reminder_2h_enabled   boolean not null default true,
  add column if not exists sms_template_confirmation text,
  add column if not exists sms_template_reminder_24h text,
  add column if not exists sms_template_reminder_2h  text;

-- ── SMS send log ────────────────────────────────────────────────
create table if not exists public.sms_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  contact_id       uuid references public.contacts(id)      on delete set null,
  consultation_id  uuid references public.consultations(id) on delete set null,
  message_type     text not null,
  -- confirmation | reminder_24h | reminder_2h
  to_number        text not null,
  body             text not null,
  status           text not null,
  -- sent | failed | skipped
  provider_id      text,   -- Twilio message SID on success
  error_message    text,   -- reason on failed/skipped
  sent_at          timestamptz not null default now()
);

alter table public.sms_log enable row level security;

-- Org members can read their own logs
create policy "org_isolation" on public.sms_log
  using (organization_id = (
    select organization_id from public.profiles where id = auth.uid()
  ));

create index sms_log_org_idx            on public.sms_log (organization_id, sent_at desc);
create index sms_log_consultation_idx   on public.sms_log (consultation_id);
create index sms_log_contact_idx        on public.sms_log (contact_id);

-- ============================================================
-- AI Twin per-org controls — Phase 1 Week 4
--
-- Clinic owners need a kill-switch and quiet-hours guard on the
-- auto-drafting behavior. Without these, every inbound after-hours
-- spawns a draft that sits stale until morning and a single concerned
-- owner has no way to pause the experiment without our help.
--
-- ai_twin_enabled       master switch. Defaults true to preserve
--                       current behavior for orgs already on the
--                       Phase 1 W1+W2 build.
-- ai_twin_quiet_hours_*  HH:MM:SS local-to-organizations.timezone
--                       window. Both NULL = always on. The window is
--                       interpreted [start, end), and is allowed to
--                       wrap across midnight (e.g. 21:00 -> 08:00).
-- ai_twin_voice_profile  placeholder for W6-7 voice/style fine-tune
--                       config. Created now so the column is in place
--                       and we don't migrate again later — DO NOT
--                       read this column anywhere in W4 code.
-- ============================================================

alter table public.organizations
  add column if not exists ai_twin_enabled boolean not null default true,
  add column if not exists ai_twin_quiet_hours_start time,
  add column if not exists ai_twin_quiet_hours_end   time,
  add column if not exists ai_twin_voice_profile jsonb not null default '{}'::jsonb;

-- Both-or-neither: a half-configured window is a footgun.
alter table public.organizations
  add constraint ai_twin_quiet_hours_paired_chk
  check (
    (ai_twin_quiet_hours_start is null and ai_twin_quiet_hours_end is null)
    or
    (ai_twin_quiet_hours_start is not null and ai_twin_quiet_hours_end is not null
     and ai_twin_quiet_hours_start <> ai_twin_quiet_hours_end)
  );

comment on column public.organizations.ai_twin_enabled is
  'Master switch for the AI Front-Desk Twin auto-draft behavior. False = skip drafting silently.';
comment on column public.organizations.ai_twin_quiet_hours_start is
  'Local-time (organizations.timezone) start of the do-not-surface window for AI drafts.';
comment on column public.organizations.ai_twin_quiet_hours_end is
  'Local-time (organizations.timezone) end of the do-not-surface window for AI drafts. May wrap past midnight.';
comment on column public.organizations.ai_twin_voice_profile is
  'Placeholder for Phase 1 W6-7 voice/style configuration. Do not consume in W4.';

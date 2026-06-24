-- Phase 2 W9 — autonomous send infrastructure.
--
-- Adds the master toggle + per-class allowlist on organizations and
-- introduces the 'auto_sent' state on ai_drafts so the inbound
-- auto-draft path can dispatch SMS without human review when the
-- owner has explicitly opted in for the inferred message class.
--
-- DEFAULTS ARE OFF.  Master toggle defaults to false; allowlist
-- defaults to empty.  An org sees zero behavioral change until the
-- owner flips the toggle AND adds at least one class to the
-- allowlist in Settings → AI Twin · Autonomous mode.

-- ── Org-level settings ──────────────────────────────────────────
alter table organizations
  add column if not exists ai_twin_auto_send_enabled boolean not null default false,
  add column if not exists ai_twin_auto_send_classes text[] not null default '{}'::text[];

-- ── Allow 'auto_sent' as an ai_drafts.state value ───────────────
-- The original CHECK constraint was declared inline and got a
-- Postgres-generated name.  Find it dynamically by matching its
-- definition, then drop + re-add with our explicit name + extended
-- value list.
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
    where conrelid = 'public.ai_drafts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%state%pending%';
  if cname is not null then
    execute format('alter table ai_drafts drop constraint %I', cname);
  end if;
end$$;

alter table ai_drafts
  add constraint ai_drafts_state_check
  check (state in (
    'pending',
    'sent',
    'edited',
    'rejected',
    'expired',
    'guardrail_failed',
    'auto_sent'
  ));

-- ── Idempotency: never two auto-sent drafts for the same trigger ─
-- Mirrors the existing partial unique index on pending drafts so a
-- double-fire of autoDraftForInbound (webhook retry, race) can't
-- result in two SMS going out.
create unique index if not exists ai_drafts_one_auto_sent_per_trigger_idx
  on ai_drafts (trigger_message_id)
  where state = 'auto_sent';

-- ── Comments for future readers ─────────────────────────────────
comment on column organizations.ai_twin_auto_send_enabled is
  'Phase 2 W9 — master toggle for autonomous SMS reply on inbound. When false, every AI draft is held for human review. Default false.';
comment on column organizations.ai_twin_auto_send_classes is
  'Phase 2 W9 — text[] of voice_example classes that may auto-send when the master toggle is on (e.g. {greeting,consult_confirm}). Empty disables auto-send even when the toggle is on.';

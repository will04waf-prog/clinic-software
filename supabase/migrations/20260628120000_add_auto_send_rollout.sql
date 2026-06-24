-- Phase 2 W12 — Rollout controls for autonomous SMS send.
--
-- Adds two opt-in controls layered on top of W9's master toggle:
--   - ai_twin_auto_send_rollout_pct: gradual-trust dial 0..100.
--     Defaults to 100 so existing W9 installs keep current behavior
--     (when master is on, every eligible inbound is auto-sent).
--   - ai_twin_auto_send_shadow_mode: when true, eligibility is
--     evaluated and the "would-have-sent" decision is persisted via
--     activity_log + ai_drafts.context_snapshot, but Twilio is NEVER
--     invoked. Lets owners preview autonomous behavior safely.
--
-- Each statement is on its own line so Supabase Studio's SQL editor
-- can't get confused by multi-line ADD COLUMN + inline CHECK forms.

alter table organizations add column if not exists ai_twin_auto_send_rollout_pct smallint not null default 100;

alter table organizations add column if not exists ai_twin_auto_send_shadow_mode boolean not null default false;

-- CHECK constraint as a separate statement, wrapped in a DO block so
-- re-running the migration after the constraint already exists is a
-- no-op rather than an error.
do $$
begin
  alter table organizations
    add constraint ai_twin_auto_send_rollout_pct_check
    check (ai_twin_auto_send_rollout_pct >= 0 and ai_twin_auto_send_rollout_pct <= 100);
exception when duplicate_object then null;
end$$;

comment on column organizations.ai_twin_auto_send_rollout_pct is
  'W12: percentage (0-100) of eligible inbounds that actually auto-send. Bucketed by FNV-1a hash of (contact_id, message_class) so each contact is sticky in or out of the cohort. Default 100 = W9 behavior.';

comment on column organizations.ai_twin_auto_send_shadow_mode is
  'W12: when true, AI Twin evaluates eligibility and logs would-have-sent decisions but does NOT invoke Twilio. Lets owners preview autonomous behavior without patient impact.';

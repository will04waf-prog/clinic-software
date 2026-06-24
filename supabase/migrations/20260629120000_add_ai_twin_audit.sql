-- Phase 2 W11 — audit + safety.
--
-- Adds the indexes and constraints needed for the /ai-twin/audit page
-- and the flag-mis-send feature. No new tables: every W11 event is an
-- activity_log row, and every flagged draft is referenced by
-- metadata.draft_id rather than a separate join table. Keeping the
-- write path in activity_log means the W7/W8 retraining signal lives
-- alongside ai_draft_sent / ai_draft_edited / ai_draft_rejected, which
-- is the surface those aggregators already read.
--
-- Each CREATE INDEX is on a single line so the Supabase SQL editor's
-- parser cannot split a multi-line IN-list on whitespace.

create index if not exists activity_log_org_ai_twin_idx on public.activity_log (organization_id, created_at desc) where action in ('ai_draft_generated','ai_draft_sent','ai_draft_edited','ai_draft_rejected','ai_twin_auto_sent','ai_twin_auto_sent_flagged','ai_twin_auto_send_settings_changed','ai_twin_auto_send_shadow_simulated','ai_twin_auto_send_rollout_throttled');

create unique index if not exists activity_log_one_flag_per_draft_per_user_idx on public.activity_log ((metadata->>'draft_id'), (metadata->>'flagged_by_user_id')) where action = 'ai_twin_auto_sent_flagged';

comment on index public.activity_log_org_ai_twin_idx is 'Phase 2 W11/W12 — partial index powering /ai-twin/audit. Restricted to AI Twin action types so it stays small on high-volume orgs.';

comment on index public.activity_log_one_flag_per_draft_per_user_idx is 'Phase 2 W11 — prevents same user from flagging same auto_sent draft twice. Flag API surfaces violation as HTTP 409.';

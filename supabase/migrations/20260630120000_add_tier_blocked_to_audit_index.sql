-- Phase 2 tier-gating follow-up — extend the W11 audit partial index
-- to cover the new ai_twin_auto_send_tier_blocked action.
--
-- The runtime gate in src/lib/auto-send.ts writes this action when an
-- inbound is refused because the org's effective tier no longer
-- includes autonomous send (e.g. downgraded from Scale). The W11
-- partial index activity_log_org_ai_twin_idx must include it in its
-- WHERE clause for the audit page query to use the index.

drop index if exists activity_log_org_ai_twin_idx;

create index if not exists activity_log_org_ai_twin_idx on public.activity_log (organization_id, created_at desc) where action in ('ai_draft_generated','ai_draft_sent','ai_draft_edited','ai_draft_rejected','ai_twin_auto_sent','ai_twin_auto_sent_flagged','ai_twin_auto_send_settings_changed','ai_twin_auto_send_shadow_simulated','ai_twin_auto_send_rollout_throttled','ai_twin_auto_send_tier_blocked');

comment on index public.activity_log_org_ai_twin_idx is 'Phase 2 W11/W12 + tier-gating — partial index powering /ai-twin/audit. Restricted to AI Twin action types so it stays small on high-volume orgs.';

-- Multi-vertical Phase 4 — urgency triage (trades vertical).
--
-- Additive. is_urgent defaults false so every existing and future
-- non-trades call is unchanged; urgency_reason is nullable.
--
--   call_logs.is_urgent        — true when flag_urgent fired on the
--                                call (a trades business emergency:
--                                burst pipe, no water, gas smell…).
--                                Set at call-end by copying the
--                                voice_urgent_flag activity_log row.
--   call_logs.urgency_reason   — the caller's stated issue, for the
--                                CRM timeline. NULL when not urgent.
--
-- Med-spa impact: none. flag_urgent is wired only into trades
-- assistants, so med-spa calls never set these; is_urgent stays false.
--
-- RLS: columns on call_logs, which already has its org-scoped
-- policies. Covered automatically; no new policy. Phase 5 adds the
-- cross-tenant test.

alter table public.call_logs
  add column if not exists is_urgent boolean not null default false,
  add column if not exists urgency_reason text;

comment on column public.call_logs.is_urgent is
  'Multi-vertical Phase 4: true when flag_urgent fired (trades business emergency). Default false; med-spa calls never set it.';

comment on column public.call_logs.urgency_reason is
  'Multi-vertical Phase 4: the caller''s stated urgent issue, copied from the voice_urgent_flag activity_log row at call-end. NULL when not urgent.';

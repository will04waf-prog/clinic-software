-- Phase 5 W2 hardening — turn the activity_log rate-limit sentinel into
-- the rate-limit primitive itself, killing a TOCTOU race in
-- /api/voice/tool/send-link-sms.
--
-- Background: the route's pre-send gate did
--
--   SELECT ... FROM activity_log
--   WHERE action='voice_link_sent'
--     AND created_at >= now()-60s
--     AND metadata @> {link_kind, from_e164_tail}
--
-- and only INSERT'd the sentinel row AFTER the Twilio call. Two near-
-- simultaneous LLM-driven tool calls (Layla can fire the same tool
-- twice on a flaky turn, and Vapi will retry on a slow first response)
-- both passed the SELECT, both INSERTed, and both fired SMS. The
-- caller's pocket buzzed twice.
--
-- The fix moves the INSERT to BEFORE the Twilio call and relies on the
-- database to serialize concurrent attempts: only one row per
-- (org, link_kind, from_e164_tail, minute) can exist. The second
-- concurrent INSERT gets a 23505 unique-violation, the route maps that
-- to `rate_limited` and short-circuits. No race window.
--
-- Why a partial index instead of a full uniqueness constraint:
--   - activity_log holds many other actions; we only want this
--     restriction on voice_link_sent rows.
--   - date_trunc('minute', created_at) gives us a 60s-resolution
--     bucket without a separate column. The route's "is there a row
--     within the last 60s" gate previously used >= now()-60s; the
--     bucketed approach is slightly more permissive at minute
--     boundaries (e.g. a send at :59 and another at :00 are in
--     different buckets) but trades a tiny edge-case for a clean
--     unique-index primitive. Acceptable: a runaway LLM hammering
--     the tool is still capped to ~1 SMS/minute/(kind, caller).
--   - WHERE action='voice_link_sent' keeps the index small.
--
-- Coordinated with: src/app/api/voice/tool/send-link-sms/route.ts
-- restructure that catches 23505 → rate_limited and DELETEs the
-- sentinel on Twilio failure so a failed send doesn't block a
-- legitimate retry.

-- Pre-deploy de-dup + bucket-time function. Notes:
--   1. date_trunc('minute', timestamptz) AND extract(epoch from
--      timestamptz) are both marked STABLE (not IMMUTABLE) in
--      stock Postgres, so neither can live directly inside a
--      partial-index expression. We wrap epoch-bucketing in our own
--      IMMUTABLE SQL function. The math really IS deterministic for
--      timestamptz: epoch values are session-timezone-independent.
--      Declaring the wrapper IMMUTABLE is technically a lie to PG
--      but a safe one — the result depends only on the input value.
--   2. The previously-deployed route (commit 14ce75f) already wrote
--      voice_link_sent rows under the racey SELECT-then-INSERT
--      pattern. If the race fired, there could be pre-existing
--      duplicates that would block CREATE UNIQUE INDEX with 23505.
--      Keep the earliest row per bucket — it's the one that drove
--      the SMS send; the loser of the race is the dupe.

create or replace function public.tz_minute_bucket(ts timestamptz)
returns bigint
language sql
immutable
parallel safe
as $$ select (extract(epoch from ts)::bigint / 60) $$;

delete from public.activity_log a
using public.activity_log b
where a.action = 'voice_link_sent'
  and b.action = 'voice_link_sent'
  and a.organization_id = b.organization_id
  and (a.metadata->>'link_kind')      = (b.metadata->>'link_kind')
  and (a.metadata->>'from_e164_tail') = (b.metadata->>'from_e164_tail')
  and public.tz_minute_bucket(a.created_at) = public.tz_minute_bucket(b.created_at)
  and a.created_at > b.created_at;

create unique index if not exists activity_log_voice_link_sent_uniq
  on public.activity_log (
    organization_id,
    (metadata->>'link_kind'),
    (metadata->>'from_e164_tail'),
    public.tz_minute_bucket(created_at)
  )
  where action = 'voice_link_sent';

comment on index public.activity_log_voice_link_sent_uniq is
  'Phase 5 W2: rate-limit primitive for /api/voice/tool/send-link-sms. One sentinel row per (org, link_kind, from_e164_tail, minute). Second concurrent INSERT raises 23505 → route returns rate_limited.';

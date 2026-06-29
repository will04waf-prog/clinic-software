-- ─────────────────────────────────────────────────────────────────────
-- M1 — Multi-clinic phone-number infrastructure (foundation).
--
-- Lays the schema for per-org Twilio + Vapi phone resources, the A2P
-- 10DLC registration record, the durable provisioning_jobs queue that
-- M5's runner will drain, and the usage_events ledger that M7's daily
-- Stripe reporter will read.
--
-- Up to now, the codebase shared a SINGLE Twilio number + SINGLE Vapi
-- phone-number resource via TWILIO_PHONE_NUMBER + VAPI_PHONE_NUMBER_ID
-- env vars. That falls over the moment we onboard a second clinic —
-- every patient call lands at the same number and the AI assistant
-- can't be branded per clinic. After this migration each org owns its
-- own (twilio_phone_sid, vapi_phone_number_id) pair and the voice-
-- reminder cron reads from the row instead of the env.
--
-- Idempotent: every ALTER / CREATE uses IF NOT EXISTS or DO-block
-- guards so a partial-apply on staging is safe to re-paste.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. organizations: per-org phone + A2P columns ────────────────────
ALTER TABLE public.organizations
  -- The Vapi-side phone-number resource id. Set by the provisioning
  -- step that POSTs to https://api.vapi.ai/phone-number after the
  -- Twilio number is purchased. This is the value the outbound-call
  -- wrapper now expects per-call (was reading the VAPI_PHONE_NUMBER_ID
  -- env). Distinct from call_agent_assistant_id, which is the LLM
  -- assistant config — this is the dialable PSTN resource.
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id text,

  -- Twilio IncomingPhoneNumber SID. Distinct from twilio_phone_number
  -- (which stores the E.164). Stored so we can DELETE / release the
  -- number later (e.g. if a clinic churns) without scanning the Twilio
  -- account list. Twilio's POST /IncomingPhoneNumbers is idempotent on
  -- (AccountSid, PhoneNumber) so re-runs of the provisioning script
  -- return the same SID rather than double-charging.
  ADD COLUMN IF NOT EXISTS twilio_phone_sid text,

  -- Audit trail. Useful for billing reconciliation and for the
  -- super-admin dashboard's "number age" column.
  ADD COLUMN IF NOT EXISTS phone_number_purchased_at timestamptz,

  -- Twilio currently charges $1.15/mo for a US local number. Storing
  -- cents (not a float) keeps the metered-billing rollups exact.
  -- Default 115 because that's the public list price; M7's billing
  -- reporter reads this column for the per-month rent line item.
  ADD COLUMN IF NOT EXISTS phone_number_monthly_cost_cents integer NOT NULL DEFAULT 115,

  -- A2P 10DLC BrandRegistrations SID (BN…). Returned by Twilio's
  -- TrustHub a2p/BrandRegistrations create call. Required for outbound
  -- SMS to deliver reliably to US carriers post-March-2024.
  ADD COLUMN IF NOT EXISTS a2p_brand_sid text,

  -- A2P UseCase / Campaign SID. Created AFTER brand approval; tied to
  -- the org's phone numbers via Twilio's MessagingService.
  ADD COLUMN IF NOT EXISTS a2p_campaign_sid text,

  -- Lifecycle state for the A2P registration. Default 'not_started'
  -- so existing orgs (pre-M4) cleanly read as "no registration
  -- attempted" rather than misleadingly 'pending'. The M4 SMS gate
  -- (A2P_SMS_BLOCK_ENABLED) checks this column.
  ADD COLUMN IF NOT EXISTS a2p_status text NOT NULL DEFAULT 'not_started',

  -- When the a2p_status column last changed. Drives the super-admin
  -- dashboard's "last update" column and the cron's stale-check
  -- (we don't want to spam Twilio's polling endpoint for brands that
  -- were approved months ago).
  ADD COLUMN IF NOT EXISTS a2p_status_updated_at timestamptz,

  -- The full brand-registration payload (legal business name, EIN,
  -- address, authorized representative, etc.). Stored verbatim so
  -- (a) we can resubmit if Twilio rejects without re-collecting from
  -- the owner, and (b) we have an audit trail for compliance review.
  -- Sensitive — contains EIN — but already gated by RLS via the org
  -- isolation policy on organizations.
  ADD COLUMN IF NOT EXISTS a2p_brand_data jsonb;

-- CHECK constraint added in a DO block so DROP+ADD is idempotent if
-- we later expand the enum.
DO $a2p_status_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_a2p_status_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_a2p_status_check
      CHECK (a2p_status IN ('pending', 'approved', 'rejected', 'not_started'));
  END IF;
END
$a2p_status_check$;

COMMENT ON COLUMN public.organizations.vapi_phone_number_id IS
  'Phase 5 M1: per-org Vapi phone-number resource id. Set by the provisioning step; replaces the single VAPI_PHONE_NUMBER_ID env var that gated the whole platform.';

COMMENT ON COLUMN public.organizations.twilio_phone_sid IS
  'Phase 5 M1: Twilio IncomingPhoneNumber SID for the per-org number. Stored so we can release the number later without scanning the Twilio account list.';

COMMENT ON COLUMN public.organizations.phone_number_monthly_cost_cents IS
  'Phase 5 M1: monthly cost in cents (default 115 = $1.15 US local). Read by M7''s metered-billing reporter to emit the per-month rent line item.';

COMMENT ON COLUMN public.organizations.a2p_status IS
  'Phase 5 M1: lifecycle of the A2P 10DLC BrandRegistration. not_started → pending → approved | rejected. Gates outbound SMS in M4 when A2P_SMS_BLOCK_ENABLED is on.';

COMMENT ON COLUMN public.organizations.a2p_brand_data IS
  'Phase 5 M1: full TrustHub EndUser + BrandRegistration payload for audit + resubmission. Contains EIN — sensitive; relies on org-isolation RLS.';


-- ── 2. provisioning_jobs: durable retry queue ────────────────────────
-- M5's runner SELECTs ready rows here, dispatches to step handlers,
-- and writes back outcomes. Each row represents one step of the
-- multi-step provisioning dance: 'buy_twilio_number',
-- 'register_vapi_phone', 'register_a2p_brand', 'register_a2p_campaign'.
-- The (organization_id, step) partial-unique index below prevents the
-- API or the user from enqueueing the same step twice while it's
-- still in flight or succeeded — re-enqueue requires marking the
-- existing row as failed first.
CREATE TABLE IF NOT EXISTS public.provisioning_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Free-form step name. The runner switches on this to dispatch to
  -- the right handler in src/lib/provisioning/steps.ts (M5). Not
  -- constrained at the DB layer so M2-M7 can each add steps without
  -- a migration; a typo blows up at dispatch with a clear error
  -- rather than at INSERT with an opaque constraint name.
  step            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed')),
  -- Attempt counter. M5's queue lib uses this to compute exponential
  -- backoff (next_run_at = now() + min(2^attempts, 3600)s).
  attempts        integer     NOT NULL DEFAULT 0,
  -- Free-form payload for the step. Example shapes:
  --   buy_twilio_number:    { area_code: '510', country: 'US' }
  --   register_vapi_phone:  { e164: '+14155551234', assistant_id: '…' }
  --   register_a2p_brand:   { business_name: '…', ein: '…', … }
  payload         jsonb,
  -- Last error string (Twilio / Vapi error message, truncated). NULL
  -- on success / pending. The super-admin dashboard shows this verbatim
  -- so the operator can see WHY a step failed without grepping logs.
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  succeeded_at    timestamptz
);

-- Partial unique index: one active step at a time per (org, step).
-- A second enqueue while the first is pending / in_progress / succeeded
-- raises 23505 and the API returns 409 to the caller. Failed rows
-- are excluded so a stuck job can be retried by inserting a fresh row
-- (with attempts=0) without manual cleanup.
CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_one_active_per_step_uniq
  ON public.provisioning_jobs (organization_id, step)
  WHERE status IN ('pending', 'in_progress', 'succeeded');

-- Cron pickup query: ORDER BY created_at ASC WHERE status='pending'.
-- An index on (status, created_at) keeps that fast even after we've
-- accumulated thousands of succeeded rows.
CREATE INDEX IF NOT EXISTS provisioning_jobs_status_created_idx
  ON public.provisioning_jobs (status, created_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS provisioning_jobs_org_idx
  ON public.provisioning_jobs (organization_id, created_at DESC);

ALTER TABLE public.provisioning_jobs ENABLE ROW LEVEL SECURITY;

-- Owner-only read: the queue is administrative state, not patient
-- data, but the last_error / payload fields can leak Twilio config
-- details. Restricting to owners (not staff) keeps the surface
-- minimal. Mutations happen via service-role from the API / cron.
DO $provisioning_jobs_rls$
BEGIN
  DROP POLICY IF EXISTS provisioning_jobs_owner_read ON public.provisioning_jobs;
  CREATE POLICY provisioning_jobs_owner_read
    ON public.provisioning_jobs
    FOR SELECT
    USING (
      organization_id IN (
        SELECT organization_id FROM public.profiles
        WHERE id = auth.uid()
          AND is_active = true
          AND role = 'owner'
      )
    );
END
$provisioning_jobs_rls$;

-- Touch trigger on updated_at so the cron doesn't have to remember
-- to set it on every status flip.
CREATE OR REPLACE FUNCTION public.provisioning_jobs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS provisioning_jobs_touch_updated_at ON public.provisioning_jobs;
CREATE TRIGGER provisioning_jobs_touch_updated_at
  BEFORE UPDATE ON public.provisioning_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.provisioning_jobs_touch_updated_at();

COMMENT ON TABLE public.provisioning_jobs IS
  'Phase 5 M1: durable retry queue for multi-step Twilio + Vapi + A2P provisioning. M5''s runner claims rows where status=pending, dispatches to step handlers, and writes outcomes. The (org, step) partial-unique index prevents double-enqueue.';


-- ── 3. usage_events: per-org usage ledger ────────────────────────────
-- M7's daily Stripe reporter reads ungated rows (reported_to_stripe_at
-- IS NULL), aggregates by (org, billing_period), and emits one Stripe
-- usage_record per kind per period. Storing raw events (not just
-- per-period rollups) means we can re-aggregate if a billing period
-- needs adjustment without losing the source data.
CREATE TABLE IF NOT EXISTS public.usage_events (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The metered dimension. Each kind maps to a separate Stripe price
  -- in M7. We store quantity (not unit) so a 'voice_minute' row of
  -- quantity=3.5 means 3.5 minutes — the Stripe usage_record gets
  -- ceil()'d at the reporter.
  kind                     text        NOT NULL
    CHECK (kind IN ('voice_minute', 'sms_segment', 'phone_number_rent')),
  quantity                 numeric     NOT NULL,
  -- Period bounds let the reporter group rows correctly even when a
  -- call straddles a billing-period boundary (rare but possible for
  -- voicemail-style long calls overnight on the 1st of the month).
  billing_period_start     date        NOT NULL,
  billing_period_end       date        NOT NULL,
  -- NULL until the daily Stripe reporter (M7) emits a usage_record
  -- for this row. The reporter's WHERE clause is
  -- "reported_to_stripe_at IS NULL AND billing_period_end < today".
  reported_to_stripe_at    timestamptz,
  -- The Stripe usage_record id returned by stripe.subscriptionItems
  -- .createUsageRecord. Stored for idempotency on retries — if a
  -- reporter run partially succeeded, the next pass can skip rows
  -- whose record id is already set.
  stripe_usage_record_id   text,
  -- Free-form reference back to the source row (e.g. call_logs.id,
  -- sms_outbound.provider_id). Lets reconciliation queries trace
  -- a Stripe line item back to the originating event.
  source_ref               text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Daily reporter pickup query: WHERE org_id = $1 AND billing_period_end
-- < CURRENT_DATE AND reported_to_stripe_at IS NULL. Partial index over
-- the un-reported rows keeps the planner from scanning a table that
-- accumulates forever.
CREATE INDEX IF NOT EXISTS usage_events_unreported_idx
  ON public.usage_events (organization_id, billing_period_end)
  WHERE reported_to_stripe_at IS NULL;

CREATE INDEX IF NOT EXISTS usage_events_org_period_idx
  ON public.usage_events (organization_id, billing_period_start, billing_period_end);

CREATE INDEX IF NOT EXISTS usage_events_kind_idx
  ON public.usage_events (organization_id, kind, billing_period_start);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- Owner-only read. Staff don't need billing visibility. Inserts come
-- via service-role from call-end / sms hooks; the daily reporter
-- (also service-role) updates reported_to_stripe_at.
DO $usage_events_rls$
BEGIN
  DROP POLICY IF EXISTS usage_events_owner_read ON public.usage_events;
  CREATE POLICY usage_events_owner_read
    ON public.usage_events
    FOR SELECT
    USING (
      organization_id IN (
        SELECT organization_id FROM public.profiles
        WHERE id = auth.uid()
          AND is_active = true
          AND role = 'owner'
      )
    );
END
$usage_events_rls$;

COMMENT ON TABLE public.usage_events IS
  'Phase 5 M1: per-org metered-billing event ledger. Read by M7''s daily Stripe reporter (one usage_record per kind per billing period). Raw events (not rollups) so reaggregation is lossless.';

-- ============================================================
-- Tarhunna – Demo Data Seed
-- Paste into Supabase SQL Editor and run once.
-- Auto-detects your organization and pipeline stages.
-- Safe to re-run: checks for existing demo contacts first.
-- ============================================================

DO $$
DECLARE
  v_org_id              uuid;
  v_stage_new_lead      uuid;
  v_stage_contacted     uuid;
  v_stage_consult_booked uuid;
  v_stage_consult_done  uuid;
  v_stage_proposal      uuid;
  v_stage_closed_won    uuid;
  v_stage_old_lead      uuid;
  v_stage_no_show       uuid;

  -- Pre-assigned contact IDs so consultations can reference them
  v_sofia     uuid := uuid_generate_v4();
  v_james     uuid := uuid_generate_v4();
  v_valentina uuid := uuid_generate_v4();
  v_marcus    uuid := uuid_generate_v4();
  v_isabella  uuid := uuid_generate_v4();
  v_daniel    uuid := uuid_generate_v4();
  v_priya     uuid := uuid_generate_v4();
  v_robert    uuid := uuid_generate_v4();

BEGIN
  -- ── Resolve org ───────────────────────────────────────────
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found. Make sure you are signed up first.';
  END IF;

  -- ── Resolve pipeline stages ───────────────────────────────
  SELECT id INTO v_stage_new_lead      FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%new lead%'           LIMIT 1;
  SELECT id INTO v_stage_contacted     FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%contacted%'          LIMIT 1;
  SELECT id INTO v_stage_consult_booked FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%consultation booked%' LIMIT 1;
  SELECT id INTO v_stage_consult_done  FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%consultation done%'   LIMIT 1;
  SELECT id INTO v_stage_proposal      FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%proposal%'           LIMIT 1;
  SELECT id INTO v_stage_closed_won    FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%closed%won%'         LIMIT 1;
  SELECT id INTO v_stage_old_lead      FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%old lead%'           LIMIT 1;
  SELECT id INTO v_stage_no_show       FROM pipeline_stages WHERE organization_id = v_org_id AND name ILIKE '%no-show%'            LIMIT 1;

  -- ── Guard: skip if demo data already exists ───────────────
  IF EXISTS (
    SELECT 1 FROM contacts
    WHERE organization_id = v_org_id AND email = 'sofia.martinez.demo@tarhunna.com'
  ) THEN
    RAISE NOTICE 'Demo data already seeded. Skipping.';
    RETURN;
  END IF;

  -- ── Contacts ──────────────────────────────────────────────
  -- 2 patients, 5 active leads across stages, 1 inactive
  INSERT INTO contacts (
    id, organization_id, stage_id,
    first_name, last_name, email, phone,
    source, procedure_interest, status, notes,
    last_activity_at, created_at, updated_at
  ) VALUES

    -- ── PATIENTS ──────────────────────────────────────────
    (
      v_sofia, v_org_id, v_stage_consult_done,
      'Sofia', 'Martinez', 'sofia.martinez.demo@tarhunna.com', '(305) 555-0101',
      'instagram', ARRAY['botox','lip_filler'], 'patient',
      'Very happy with the consultation. Ready to schedule treatment.',
      now() - interval '3 days', now() - interval '6 weeks', now() - interval '3 days'
    ),
    (
      v_james, v_org_id, v_stage_closed_won,
      'James', 'Chen', 'james.chen.demo@tarhunna.com', '(305) 555-0102',
      'referral', ARRAY['body_contouring','weight_loss'], 'patient',
      'Referred by a friend. Treatments completed successfully.',
      now() - interval '1 week', now() - interval '8 weeks', now() - interval '1 week'
    ),

    -- ── LEADS WITH CONSULTATIONS BOOKED ───────────────────
    (
      v_valentina, v_org_id, v_stage_consult_booked,
      'Valentina', 'Torres', 'valentina.torres.demo@tarhunna.com', '(305) 555-0103',
      'instagram', ARRAY['skin_tightening','microneedling'], 'lead',
      'Came in from IG story. Interested in skin tightening, has done research already.',
      now() - interval '1 day', now() - interval '2 weeks', now() - interval '1 day'
    ),
    (
      v_marcus, v_org_id, v_stage_consult_booked,
      'Marcus', 'Johnson', 'marcus.johnson.demo@tarhunna.com', '(305) 555-0104',
      'facebook', ARRAY['body_contouring','chemical_peel'], 'lead',
      'Wants to combine body contouring and a chemical peel. Asking about downtime.',
      now() - interval '2 days', now() - interval '10 days', now() - interval '2 days'
    ),

    -- ── ACTIVE LEADS IN PIPELINE ──────────────────────────
    (
      v_isabella, v_org_id, v_stage_contacted,
      'Isabella', 'Rivera', 'isabella.rivera.demo@tarhunna.com', '(305) 555-0105',
      'referral', ARRAY['botox','fillers'], 'lead',
      'Warm lead from Maria Chen. Reached out twice, responsive over email.',
      now() - interval '4 days', now() - interval '3 weeks', now() - interval '4 days'
    ),
    (
      v_daniel, v_org_id, v_stage_new_lead,
      'Daniel', 'Kim', 'daniel.kim.demo@tarhunna.com', '(305) 555-0106',
      'website', ARRAY['microneedling'], 'lead',
      NULL,
      now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours'
    ),
    (
      v_priya, v_org_id, v_stage_proposal,
      'Priya', 'Patel', 'priya.patel.demo@tarhunna.com', '(305) 555-0107',
      'instagram', ARRAY['prp','hydrafacial'], 'lead',
      'Sent treatment plan and pricing. Following up end of week.',
      now() - interval '5 days', now() - interval '4 weeks', now() - interval '5 days'
    ),

    -- ── INACTIVE ──────────────────────────────────────────
    (
      v_robert, v_org_id, v_stage_old_lead,
      'Robert', 'Walsh', 'robert.walsh.demo@tarhunna.com', '(305) 555-0108',
      'walkin', ARRAY['botox'], 'inactive',
      'Walked in 2 months ago. Never responded to follow-ups.',
      now() - interval '3 weeks', now() - interval '10 weeks', now() - interval '3 weeks'
    );

  -- ── Consultations ─────────────────────────────────────────
  -- 1 completed (past), 1 confirmed (tomorrow), 1 scheduled (next week)
  INSERT INTO consultations (
    id, organization_id, contact_id,
    scheduled_at, duration_min, type, status,
    procedure_discussed, pre_consult_notes,
    post_consult_notes, reminder_24h_sent, reminder_2h_sent,
    created_at, updated_at
  ) VALUES

    -- Sofia – completed 2 weeks ago
    (
      uuid_generate_v4(), v_org_id, v_sofia,
      now() - interval '2 weeks', 60, 'in_person', 'completed',
      ARRAY['botox','lip_filler'],
      'Patient wants subtle, natural results. Minimal downtime preferred.',
      'Great consultation. Patient is a strong candidate. Sent follow-up pricing.',
      true, true,
      now() - interval '2 weeks' - interval '1 day',
      now() - interval '2 weeks'
    ),

    -- Marcus – confirmed, tomorrow
    (
      uuid_generate_v4(), v_org_id, v_marcus,
      now() + interval '1 day', 60, 'virtual', 'confirmed',
      ARRAY['body_contouring','chemical_peel'],
      'Wants to discuss combining body contouring and chemical peel. Discussing downtime.',
      NULL, false, false,
      now() - interval '2 days',
      now() - interval '2 days'
    ),

    -- Valentina – scheduled, in 4 days
    (
      uuid_generate_v4(), v_org_id, v_valentina,
      now() + interval '4 days', 60, 'in_person', 'scheduled',
      ARRAY['skin_tightening','microneedling'],
      'First-time consult. Came from IG ad. Interested in a skin tightening + microneedling package.',
      NULL, false, false,
      now() - interval '1 day',
      now() - interval '1 day'
    );

  -- ── Activity Log ──────────────────────────────────────────
  INSERT INTO activity_log (organization_id, contact_id, action, created_at) VALUES
    (v_org_id, v_sofia,     'lead_created',       now() - interval '6 weeks'),
    (v_org_id, v_sofia,     'stage_changed',      now() - interval '5 weeks'),
    (v_org_id, v_sofia,     'consultation_completed', now() - interval '2 weeks'),
    (v_org_id, v_james,     'lead_created',       now() - interval '8 weeks'),
    (v_org_id, v_james,     'stage_changed',      now() - interval '6 weeks'),
    (v_org_id, v_valentina, 'lead_created',       now() - interval '2 weeks'),
    (v_org_id, v_valentina, 'stage_changed',      now() - interval '1 week'),
    (v_org_id, v_marcus,    'lead_created',       now() - interval '10 days'),
    (v_org_id, v_marcus,    'stage_changed',      now() - interval '8 days'),
    (v_org_id, v_isabella,  'lead_created',       now() - interval '3 weeks'),
    (v_org_id, v_isabella,  'stage_changed',      now() - interval '2 weeks'),
    (v_org_id, v_daniel,    'lead_created',       now() - interval '2 hours'),
    (v_org_id, v_priya,     'lead_created',       now() - interval '4 weeks'),
    (v_org_id, v_priya,     'stage_changed',      now() - interval '1 week'),
    (v_org_id, v_robert,    'lead_created',       now() - interval '10 weeks');

  RAISE NOTICE 'Demo data seeded successfully for org: %', v_org_id;
END $$;

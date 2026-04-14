-- ============================================================
-- Fix demo contact procedures to match med spa context.
-- Run once in Supabase SQL Editor.
-- ============================================================

-- Contacts
UPDATE contacts SET procedure_interest = ARRAY['botox','lip_filler'],
  notes = 'Very happy with the consultation. Ready to schedule treatment.',
  updated_at = now()
WHERE email = 'sofia.martinez.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['body_contouring','weight_loss'],
  notes = 'Referred by a friend. Treatments completed successfully.',
  updated_at = now()
WHERE email = 'james.chen.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['skin_tightening','microneedling'],
  notes = 'Came in from IG story. Interested in skin tightening, has done research already.',
  updated_at = now()
WHERE email = 'valentina.torres.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['body_contouring','chemical_peel'],
  notes = 'Wants to combine body contouring and a chemical peel. Asking about downtime.',
  updated_at = now()
WHERE email = 'marcus.johnson.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['botox','fillers'],
  updated_at = now()
WHERE email = 'isabella.rivera.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['microneedling'],
  updated_at = now()
WHERE email = 'daniel.kim.demo@tarhunna.com';

UPDATE contacts SET procedure_interest = ARRAY['prp','hydrafacial'],
  updated_at = now()
WHERE email = 'priya.patel.demo@tarhunna.com';

-- robert.walsh stays on botox — already med spa

-- Consultations (matched by contact email)
UPDATE consultations SET
  procedure_discussed = ARRAY['botox','lip_filler'],
  pre_consult_notes   = 'Patient wants subtle, natural results. Minimal downtime preferred.',
  updated_at          = now()
WHERE contact_id = (SELECT id FROM contacts WHERE email = 'sofia.martinez.demo@tarhunna.com' LIMIT 1);

UPDATE consultations SET
  procedure_discussed = ARRAY['body_contouring','chemical_peel'],
  pre_consult_notes   = 'Wants to combine body contouring and a chemical peel. Discussing downtime.',
  updated_at          = now()
WHERE contact_id = (SELECT id FROM contacts WHERE email = 'marcus.johnson.demo@tarhunna.com' LIMIT 1);

UPDATE consultations SET
  procedure_discussed = ARRAY['skin_tightening','microneedling'],
  pre_consult_notes   = 'First-time consult. Came from IG ad. Interested in a skin tightening + microneedling package.',
  updated_at          = now()
WHERE contact_id = (SELECT id FROM contacts WHERE email = 'valentina.torres.demo@tarhunna.com' LIMIT 1);

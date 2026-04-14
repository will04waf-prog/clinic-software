-- ============================================================
-- Replace ALL plastic-surgery procedure values with the nearest
-- med-spa equivalent across every contact and consultation.
-- Safe to run multiple times.
-- ============================================================

-- rhinoplasty → microneedling
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'rhinoplasty', 'microneedling'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['rhinoplasty'];

-- bbl → body_contouring
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'bbl', 'body_contouring'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['bbl'];

-- liposuction → body_contouring
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'liposuction', 'body_contouring'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['liposuction'];

-- breast_augmentation → skin_tightening
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'breast_augmentation', 'skin_tightening'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['breast_augmentation'];

-- breast_reduction → prp
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'breast_reduction', 'prp'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['breast_reduction'];

-- tummy_tuck → body_contouring
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'tummy_tuck', 'body_contouring'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['tummy_tuck'];

-- facelift → skin_tightening
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'facelift', 'skin_tightening'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['facelift'];

-- blepharoplasty → hydrafacial
UPDATE contacts
SET procedure_interest = array_replace(procedure_interest, 'blepharoplasty', 'hydrafacial'),
    updated_at = now()
WHERE procedure_interest @> ARRAY['blepharoplasty'];

-- Same replacements for consultations.procedure_discussed
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'rhinoplasty',      'microneedling'),   updated_at = now() WHERE procedure_discussed @> ARRAY['rhinoplasty'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'bbl',              'body_contouring'), updated_at = now() WHERE procedure_discussed @> ARRAY['bbl'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'liposuction',      'body_contouring'), updated_at = now() WHERE procedure_discussed @> ARRAY['liposuction'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'breast_augmentation','skin_tightening'),updated_at = now() WHERE procedure_discussed @> ARRAY['breast_augmentation'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'breast_reduction',  'prp'),            updated_at = now() WHERE procedure_discussed @> ARRAY['breast_reduction'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'tummy_tuck',        'body_contouring'), updated_at = now() WHERE procedure_discussed @> ARRAY['tummy_tuck'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'facelift',          'skin_tightening'), updated_at = now() WHERE procedure_discussed @> ARRAY['facelift'];
UPDATE consultations SET procedure_discussed = array_replace(procedure_discussed, 'blepharoplasty',    'hydrafacial'),     updated_at = now() WHERE procedure_discussed @> ARRAY['blepharoplasty'];

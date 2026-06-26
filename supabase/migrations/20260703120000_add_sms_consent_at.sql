-- Add sms_consent_at to contacts (TCPA audit timestamp).
--
-- The public-booking hold endpoint writes this column when a patient
-- ticks the SMS-consent checkbox; without it the INSERT/UPDATE 400s
-- and the booking fails. The migration was missed when sms_consent
-- (the boolean) was added — sms_consent_at gives auditors a "when
-- did they say yes" trail that pairs with the boolean.

alter table public.contacts
  add column if not exists sms_consent_at timestamptz;

comment on column public.contacts.sms_consent_at is
  'TCPA: timestamp the patient ticked the SMS-consent checkbox. Paired with sms_consent (boolean).';

-- Reconstructs the trial_ends_at column that was added out-of-band to
-- production. This migration is a no-op against the live database (column
-- already exists). It exists so that fresh migration replays — new dev DBs,
-- preview branches, future restores — produce a schema that matches prod.
--
-- Type/default match the production column exactly:
--   trial_ends_at | timestamp with time zone | nullable | no default

begin;

alter table organizations
  add column if not exists trial_ends_at timestamptz;

commit;

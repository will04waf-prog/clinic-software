-- Add per-clinic procedures list to organizations.
-- NULL means "use built-in defaults" — all existing orgs continue working unchanged.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS procedures text[] DEFAULT NULL;

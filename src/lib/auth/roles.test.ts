import { describe, it, expect } from 'vitest'
import { requireRole, isDenied, OWNER_ONLY, OWNER_ADMIN } from './roles'

// requireRole only touches supabase.from('profiles').select().eq().single(),
// so a tiny stub covers every branch without a real client.
const mockSupabase = (result: unknown) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }) }) as never

describe('requireRole (audit L4 — shared authz gate for ~30 routes)', () => {
  it('returns {orgId, role} for an allowed, active role', async () => {
    const gate = await requireRole(
      mockSupabase({ data: { organization_id: 'org1', role: 'owner', is_active: true }, error: null }),
      'u1', OWNER_ONLY,
    )
    expect(isDenied(gate)).toBe(false)
    if (!isDenied(gate)) {
      expect(gate.orgId).toBe('org1')
      expect(gate.role).toBe('owner')
    }
  })

  it('404 when the profile is missing', async () => {
    const gate = await requireRole(
      mockSupabase({ data: null, error: { message: 'not found' } }),
      'u1', OWNER_ONLY,
    )
    expect(isDenied(gate)).toBe(true)
    if (isDenied(gate)) expect(gate.response.status).toBe(404)
  })

  it('403 when the account is deactivated (is_active=false)', async () => {
    const gate = await requireRole(
      mockSupabase({ data: { organization_id: 'o', role: 'owner', is_active: false }, error: null }),
      'u1', OWNER_ONLY,
    )
    expect(isDenied(gate)).toBe(true)
    if (isDenied(gate)) expect(gate.response.status).toBe(403)
  })

  it('403 when the role is not in the allowed set', async () => {
    const gate = await requireRole(
      mockSupabase({ data: { organization_id: 'o', role: 'staff', is_active: true }, error: null }),
      'u1', OWNER_ADMIN,
    )
    expect(isDenied(gate)).toBe(true)
    if (isDenied(gate)) expect(gate.response.status).toBe(403)
  })
})

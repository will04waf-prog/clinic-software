'use client'
import Link from 'next/link'
import { Users, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Phase 4 W8 — link card on /settings pointing at /settings/team.
 *
 * Owner-only — the parent settings/page.tsx conditionally renders
 * this component only when profile.role === 'owner', and the
 * /settings/team page itself hard-redirects non-owners (defense in
 * depth).
 */
export function TeamSettingsLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-brand-600" />
          Team
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="text-gray-500">
          Invite teammates, change their role, or deactivate accounts that no
          longer need access. Each role has a different set of permissions.
        </p>
        <Link
          href="/settings/team"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Manage
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  )
}

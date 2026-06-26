/**
 * Phase 4 W8 — Team settings page.
 *
 * Owner-only. Non-owners get redirected back to /settings.
 *
 * Two cards:
 *   - TeamMembersCard: list of active + (toggleable) inactive
 *     members, role badge, owner can change role or deactivate.
 *   - TeamInvitationsCard: pending invitations + the "Invite
 *     teammate" button that opens a Dialog for email + role.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { TeamMembersCard } from '@/components/settings/team/team-members-card'
import { TeamInvitationsCard } from '@/components/settings/team/team-invitations-card'

export default async function TeamSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Defense in depth — the link card on /settings is conditionally
  // hidden for non-owners, but a non-owner hitting /settings/team
  // directly should also bounce.
  if (profile?.role !== 'owner') {
    redirect('/settings')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Team"
        subtitle="Invite teammates, change roles, and manage access"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>

        <TeamInvitationsCard currentUserId={user.id} />
        <TeamMembersCard currentUserId={user.id} />
      </div>
    </div>
  )
}

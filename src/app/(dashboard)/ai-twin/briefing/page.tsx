import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { BriefingView } from './briefing-view'

/**
 * /ai-twin/briefing — Provider Briefing page (Phase 2 W10).
 *
 * Server shell that gates on session, then renders the client view.
 * Same shape as settings/page.tsx — auth check + Header + scrollable
 * main. All data fetching is client-side against the cached endpoint
 * so the page paints fast even when the briefing query is cold.
 */
export default async function AiTwinBriefingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="AI Twin briefing"
        subtitle="What your twin handled in the last 24 hours"
      />
      <div className="flex-1 overflow-y-auto bg-[#F5EFE1] p-6">
        <div className="mx-auto max-w-4xl">
          <BriefingView />
        </div>
      </div>
    </div>
  )
}

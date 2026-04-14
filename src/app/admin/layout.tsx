import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { AdminNav } from '@/components/admin/admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Defense-in-depth: re-verify super_admin even though middleware already checked
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) redirect('/dashboard')

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="w-56 shrink-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="px-4 py-5 border-b border-gray-100">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Tarhunna</p>
          <p className="text-sm font-bold text-gray-900 mt-0.5">Super Admin</p>
          <p className="text-xs text-gray-400 mt-0.5">{profile.full_name}</p>
        </div>

        <AdminNav />

        <div className="px-3 py-4 border-t border-gray-100">
          <Link
            href="/dashboard"
            className="block text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded transition-colors"
          >
            ← Back to App
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}

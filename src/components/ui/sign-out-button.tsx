'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    setBusy(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100 active:scale-[0.98] transition-[background-color,border-color,color,transform] duration-150 disabled:opacity-50 disabled:active:scale-100"
    >
      <LogOut className="h-4 w-4 text-gray-400" />
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

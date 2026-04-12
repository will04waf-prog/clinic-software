'use client'
import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard error]', error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 max-w-lg w-full text-left">
        <p className="text-sm font-semibold text-red-700 mb-1">Page error</p>
        <p className="text-xs text-red-600 font-mono break-all">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-red-400 mt-2">digest: {error.digest}</p>
        )}
      </div>
      <button
        onClick={reset}
        className="text-sm text-indigo-600 hover:underline"
      >
        Try again
      </button>
    </div>
  )
}

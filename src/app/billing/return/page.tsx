import Link from 'next/link'
import { CheckCircle, XCircle } from 'lucide-react'

export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>
}) {
  const { success } = await searchParams

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">You're all set!</h1>
          <p className="text-sm text-gray-500 mb-6">
            Your Tarhunna Pro subscription is active. It may take a few seconds to reflect.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-sm px-6">
        <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Checkout canceled</h1>
        <p className="text-sm text-gray-500 mb-6">
          No charges were made. You can subscribe anytime from Settings.
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
        >
          Back to Settings
        </Link>
      </div>
    </div>
  )
}

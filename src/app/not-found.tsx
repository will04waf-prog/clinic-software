import Link from 'next/link'

// Branded app-wide 404 (replaces Next's raw black default). Spanish-first
// like the product, with an English echo — this page is reachable from
// shared links (estimates, invoices), so it must stay friendly and point
// somewhere useful without assuming a session.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF6EC] px-6 text-center">
      <p className="text-6xl font-extrabold tracking-tight text-[#028090]">404</p>
      <h1 className="mt-4 text-xl font-bold text-[#0B2027]">Esta página no existe.</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        El enlace puede haber cambiado o estar mal escrito.
        <span className="block text-gray-400">This page doesn&apos;t exist — the link may have changed.</span>
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gradient-brand px-6 text-base font-semibold text-white active:scale-[.99]"
        >
          Ir a mi panel
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-gray-200 bg-white px-6 text-base font-medium text-gray-600 active:scale-[.99]"
        >
          tarhunna.net
        </Link>
      </div>
      <p className="mt-10 text-xs uppercase tracking-widest text-gray-300">Tarhunna</p>
    </div>
  )
}

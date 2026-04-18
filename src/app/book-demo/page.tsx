import type { Metadata } from 'next'
import { BookDemoForm } from './book-demo-form'

export const metadata: Metadata = {
  title: 'Book a Demo — Tarhunna',
  description: 'See how Tarhunna helps med spas and aesthetic clinics capture more leads and book more consultations. Schedule a 20-minute demo with our team.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/book-demo' },
}

export default function BookDemoPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Nav */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-semibold text-gray-900">
            <img src="/icon.svg" alt="Tarhunna" className="h-7 w-7" />
            Tarhunna
          </a>
          <a
            href="/login"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign in
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          {/* Heading */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Book a 20-minute demo
            </h1>
            <p className="text-gray-500 text-lg">
              See exactly how Tarhunna captures leads, automates follow-ups, and books consultations for aesthetic clinics.
            </p>
          </div>

          {/* Trust signals */}
          <div className="flex flex-wrap justify-center gap-6 mb-10 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Live walkthrough, not a sales pitch
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Built for med spas and aesthetic clinics
            </span>
          </div>

          {/* Form */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <BookDemoForm />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-400">
        <a href="/" className="hover:text-gray-600 transition-colors">Tarhunna</a>
        {' · '}
        <a href="/med-spa-crm" className="hover:text-gray-600 transition-colors">Med Spa CRM</a>
        {' · '}
        <a href="/login" className="hover:text-gray-600 transition-colors">Sign in</a>
      </footer>
    </div>
  )
}

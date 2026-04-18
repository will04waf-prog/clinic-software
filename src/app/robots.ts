import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/signup', '/login'],
        disallow: [
          '/dashboard',
          '/leads',
          '/pipeline',
          '/consultations',
          '/automations',
          '/settings',
          '/admin',
          '/api/',
          '/onboarding',
          '/billing',
        ],
      },
    ],
    sitemap: 'https://tarhunna.net/sitemap.xml',
    host: 'https://tarhunna.net',
  }
}

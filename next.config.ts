import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // seed-assistants.ts reads the voice prompts from disk at call time
  // (they're markdown with heavy backtick use — embedding them in TS
  // template literals would mean escaping every one). File tracing
  // doesn't see fs.readFileSync paths, so without this entry the
  // lambda for the provision route ships WITHOUT the prompts and
  // self-serve assistant seeding would 500 in production only.
  // `**/*.md` (not `*.md`): composeInboundPrompt also reads the
  // vertical fragments under src/voice/prompts/verticals/ for
  // non-med-spa tenants — the old single-level glob shipped without
  // them, which would 500 the first trades/food/general provision in
  // production only.
  outputFileTracingIncludes: {
    "/api/admin/numbers/provision": ["./src/voice/prompts/**/*.md"],
    // The onboarding wizard's server actions call the same seeding
    // service in-process, so the page's lambda needs the prompts too.
    "/onboarding/phone-number": ["./src/voice/prompts/**/*.md"],
    // Language settings PATCH re-syncs the live Vapi assistant in
    // place (prompt + voice + transcriber), so its lambda needs the
    // prompts as well.
    "/api/org/language-notifications": ["./src/voice/prompts/**/*.md"],
  },
  // Med-spa wind-down: the standalone med-spa marketing page redirects to
  // the loop homepage. Permanent (301) so search engines follow it.
  async redirects() {
    return [
      { source: '/med-spa-crm', destination: '/', permanent: true },
    ]
  },
  // Security headers. HSTS was already set at the edge; these add the
  // rest of the baseline a payments app should carry. Deliberately SAFE:
  // the CSP here locks down framing, base-uri, plugins, and form targets
  // — it does NOT set script-src/style-src, which would need Next nonce
  // wiring and cross-service (Stripe/Vapi/Supabase) testing to avoid
  // breaking the app. Full script/style CSP is a tracked follow-up.
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      // We never use geolocation or the topics API; deny them platform-wide.
      // camera/microphone intentionally NOT denied — the Vapi web-call demo
      // needs the mic.
      { key: 'Permissions-Policy', value: 'geolocation=(), browsing-topics=()' },
      {
        key: 'Content-Security-Policy',
        value: [
          "frame-ancestors 'none'",       // clickjacking: nothing may frame us
          "base-uri 'self'",              // no <base> hijack
          "object-src 'none'",            // no legacy plugins
          "form-action 'self' https://checkout.stripe.com https://connect.stripe.com",
          'upgrade-insecure-requests',
        ].join('; '),
      },
    ]
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;

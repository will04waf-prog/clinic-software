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
};

export default nextConfig;

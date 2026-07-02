import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // seed-assistants.ts reads the voice prompts from disk at call time
  // (they're markdown with heavy backtick use — embedding them in TS
  // template literals would mean escaping every one). File tracing
  // doesn't see fs.readFileSync paths, so without this entry the
  // lambda for the provision route ships WITHOUT the prompts and
  // self-serve assistant seeding would 500 in production only.
  outputFileTracingIncludes: {
    "/api/admin/numbers/provision": ["./src/voice/prompts/*.md"],
    // The onboarding wizard's server actions call the same seeding
    // service in-process, so the page's lambda needs the prompts too.
    "/onboarding/phone-number": ["./src/voice/prompts/*.md"],
  },
};

export default nextConfig;

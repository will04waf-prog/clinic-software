import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit-test runner (audit H2). Pure-logic tests only — no DB/network —
// so they run fast and deterministically in CI. `@/*` mirrors the Next
// path alias in tsconfig.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Dummy values so modules that construct the Supabase client at import
    // time don't throw. Tests are pure-logic and never actually connect.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

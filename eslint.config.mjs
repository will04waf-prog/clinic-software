import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not source: agent worktrees + design-sync bundles were dragging
    // ~1,370 vendored files (80k problems) into the lint run, making
    // `npm run lint` useless as a gate.
    ".claude/**",
    "ds-bundle/**",
    ".design-sync/**",
    ".ds-sync/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;

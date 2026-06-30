# /design-sync notes — Tarhunna UI Components

## Repo shape — this is NOT a real DS package

This is a Next.js 16 app (`cliniq-mvp`), not a published component library. UI primitives live in `src/components/ui/*.tsx` and are used internally only. To make them syncable I created a **synthetic package** at `.design-sync/synth-pkg/`:

- `package.json` → `@tarhunna/ui` (private, scope-name only — never published)
- `src/index.ts` re-exports 10 components: Badge, Button, Card, Dialog, DropdownMenu, Input, Label, Select, Tabs, Textarea
- `src/components/<name>.tsx` are **copies** of `src/components/ui/<name>.tsx` with the import rewrite `from '@/lib/utils'` → `from '../utils'`
- `src/utils.ts` is a minimal copy of `cn()` from `src/lib/utils.ts` (the rest of that file — formatDate, formatPhone, etc — is app-only)

**On re-sync, if any of the 10 source files in `src/components/ui/` changes:** re-run the copy step in build.sh below before running the converter. There's no symlink because TypeScript path resolution gets confused crossing the `@/` alias boundary; a fresh copy each sync is the safe choice.

## Build commands (`buildCmd` substitute)

The converter expects a `dist/` it can read. Build that before running it:

```sh
# 1) copy fresh sources (run this if src/components/ui/* changed since last sync)
for c in badge button card dialog dropdown-menu input label select tabs textarea; do
  sed "s|from '@/lib/utils'|from '../utils'|g" "src/components/ui/${c}.tsx" \
    > ".design-sync/synth-pkg/src/components/${c}.tsx"
done

# 2) emit .d.ts
npx tsc -p .design-sync/synth-pkg/tsconfig.json

# 3) bundle the ES module (Radix + cva + clsx + tailwind-merge inlined; React + jsx-runtime external)
npx esbuild .design-sync/synth-pkg/src/index.ts \
  --bundle --format=esm --target=es2020 --jsx=automatic \
  --outfile=.design-sync/synth-pkg/dist/index.es.js \
  --external:react --external:react-dom --external:react/jsx-runtime \
  --loader:.tsx=tsx --loader:.ts=ts \
  --tsconfig=.design-sync/synth-pkg/tsconfig.json

# 4) compile Tailwind v4 → static CSS for the DS bundle
npx @tailwindcss/cli \
  -i .design-sync/synth-pkg/src/styles.css \
  -o .design-sync/synth-pkg/dist/styles.css
```

## Component scope decisions

- **In scope (10):** the 10 components listed above.
- **Skipped:** `sign-out-button.tsx` (uses `@/lib/supabase/client` — app-internal), `logo.tsx` / `logo-mark.tsx` / `signature-logo.tsx` (use `next/image` — also app-internal). If a future sync wants these, write small CSS-only / `<img>`-based shims in the synth package.

## The bundle ships 41 components, not 10

Re-exports like `export { Dialog, DialogPortal, DialogOverlay, … }` flatten Radix's sub-parts into the bundle's named-export surface. Each gets its own `<Name>.d.ts` + floor card. **That's correct** — they are real components an app could import. The 10 primitives have authored previews; the 31 sub-parts ship as floor cards (deliberate baseline — they only make sense composed inside their parent's preview, which the primitive's authored card demonstrates).

## Tailwind v4 specifics

- Theme tokens (`--color-brand-*`, etc) live in `@theme` blocks inside CSS — not in `tailwind.config.{js,ts}`. The compiled `dist/styles.css` is what ships; the converter copies it into `_ds_bundle.css`.
- The synthetic `src/styles.css` includes a `@source "./components/**/*.tsx"` directive so Tailwind v4 scans the synth-pkg's component files for utility classes. Add new utility-class usages to those files → re-run step 4.
- The `bg-gradient-brand` utility is hand-defined in the synth's `styles.css` (`@layer utilities`) because Tailwind has no built-in gradient utility for this specific stops. The Button's `default` variant uses it.

## Known render warns

None — render check is clean on this build (0 bad, 0 thin, 0 variantsIdentical).

## Re-sync risks

What could silently go stale or break next time:

- **Source drift:** if `src/components/ui/<name>.tsx` adds new exports or changes prop shapes, the synth-pkg's copies + `index.ts` barrel don't auto-update. The build's `[DTS]` line will show a different prop count, but a NEW export (e.g. a new variant prop) silently won't make it into the bundle unless `index.ts` is updated.
- **Tailwind v4 theme drift:** the synth's `src/styles.css` duplicates the brand-* tokens from `src/app/globals.css`. If new tokens land in globals.css (or existing ones change), copy them across. A drift here means design-system previews show stale colors while the app shows fresh ones — and no automated check catches it.
- **Class-coverage gap:** Tailwind v4's `@source` directive scans the synth-pkg's component files only. If a new utility class appears in an authored preview (`.design-sync/previews/<Name>.tsx`) but never in a component, it won't be in the compiled CSS. Symptom: the preview renders with that class missing. Fix: add the class to a component too, or extend `@source` to scan `.design-sync/previews/**/*.tsx`.
- **Radix major version bump:** the bundle inlines Radix; an upstream API shift would surface as `.d.ts` parse drift or as a render error. Re-grade after any `@radix-ui/*` major.
- **Playwright pin:** v1.56.x is what was installed for this sync. The cached chromium build matches that version; if `playwright` is upgraded in the future without `npx playwright install`, the render check fails with "Executable doesn't exist."

## What can be improved on the next sync

- **Author previews for the remaining 31 Radix sub-parts** (DialogContent, DropdownMenuItem, etc) if any deserve more than the floor card. Most don't; they only make sense composed.
- **Add a `Form` composition preview** stitching Label + Input + Button + Card together — the design agent would benefit from seeing the full form pattern, not just the primitives.

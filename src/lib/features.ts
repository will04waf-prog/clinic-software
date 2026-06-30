/**
 * Product feature flags.
 *
 * Reversible trims live here: flip a flag back to `true` to restore the
 * feature's nav entry, route, and in-app prompts in one place. The
 * underlying routes, components, server logic, and data are left intact
 * when a feature is hidden — this only controls the product surface.
 */
export const FEATURES: { automations: boolean } = {
  // Trimmed 2026-06-30: the multi-step automation sequence builder is
  // hidden from the product surface — low adoption for the target buyer
  // (small clinics) and redundant with the AI Twin + the reminder
  // system. The /automations route and src/lib/automations/* + the
  // automation cron remain in place; set this to `true` to bring the
  // builder back exactly as it was.
  automations: false,
}

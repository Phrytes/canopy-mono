/**
 * appFeature — S6.C (per-circle): map an op's appOrigin to the circle
 * `policy.features` key that gates its surfaces. A circle with tasks/calendar
 * OFF (the existing tab gate, `circlePolicy.js`) then also shows no inline/screen
 * buttons for those apps in chat — the per-circle half of "by preference".
 *
 * Apps NOT listed are core/always-on (stoop = the buurt, household, canopy-chat
 * itself). Pure + shared web↔mobile.
 */

export const APP_FEATURE = Object.freeze({
  'tasks-v0': 'tasks',
  tasks:      'tasks',
  calendar:   'calendar',
  folio:      'lists',
});

/** The policy.features key gating an app's surfaces, or null when ungated (core). */
export function featureForApp(appOrigin) {
  return APP_FEATURE[appOrigin] ?? null;
}

/**
 * Whether an app's surfaces are enabled for a circle, given its policy + the
 * shared `isFeatureEnabled`. Ungated (core) apps are always enabled.
 *
 * @param {string} appOrigin
 * @param {object} policy
 * @param {(policy:object, key:string)=>boolean} isFeatureEnabled
 */
export function isAppSurfaceEnabled(appOrigin, policy, isFeatureEnabled) {
  const feature = featureForApp(appOrigin);
  if (!feature) return true;
  return typeof isFeatureEnabled === 'function' ? isFeatureEnabled(policy, feature) : true;
}

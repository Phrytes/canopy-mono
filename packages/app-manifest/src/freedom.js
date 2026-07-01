/**
 * freedom — the admin FREEDOM TEMPLATE over (verb × noun) capabilities (B · Slice 2, ruling Q3).
 *
 * The creation wizard's last step lets the admin decide, PER capability, whether members may use it
 * (`enabled`), whether it's `required` or `optional` for them, and the `consequence` of opting out
 * (greyed [default] / hidden / limited). A hard PRIVACY FLOOR marks capabilities that are ALWAYS
 * opt-outable (location, real-name reveal, DMs-from-strangers, being-assignable) — those can never be
 * set `required`.
 *
 * The template is partial: any capability the admin didn't touch takes DEFAULT_ROW (enabled, optional,
 * greyed) — default-on migration (ruling Q5). `buildCapabilityMatrix` is what the wizard renders;
 * `effectiveCapabilityKeys` is the narrowed set the Slice-1 gate authorises — this is where the gate
 * finally drops BELOW app-level (an admin can disable `stoop add post` without disabling all of stoop).
 */

import { capabilitiesOf, capabilityKey } from './capabilities.js';

/** Whether a member MUST use a capability or MAY opt out (ruling Q3). */
export const FREEDOM_LEVELS = Object.freeze(['required', 'optional']);
/** What happens in the UI when a member opts out of an optional capability (ruling Q3). */
export const OPT_OUT_CONSEQUENCES = Object.freeze(['greyed', 'hidden', 'limited']);

/** The freedom row for a capability the admin template says nothing about (default-on, Q5). */
export const DEFAULT_ROW = Object.freeze({ enabled: true, freedom: 'optional', consequence: 'greyed', privacyFloor: false });

/** The apps in play — `enabledApps` (a Set|array|null); null ⇒ every app in `sources`. */
function isAppEnabled(app, enabledApps) {
  if (enabledApps == null) return true;
  const set = enabledApps instanceof Set ? enabledApps : new Set(enabledApps);
  return set.has(app);
}

/**
 * Merge a template entry over DEFAULT_ROW, enforcing the privacy floor (a floored capability can't be
 * `required`). Unknown freedom/consequence values fall back to the default.
 */
function resolveRow(entry = {}) {
  const privacyFloor = !!entry.privacyFloor;
  let freedom = FREEDOM_LEVELS.includes(entry.freedom) ? entry.freedom : DEFAULT_ROW.freedom;
  if (privacyFloor) freedom = 'optional';                                   // floor wins — never required
  const consequence = OPT_OUT_CONSEQUENCES.includes(entry.consequence) ? entry.consequence : DEFAULT_ROW.consequence;
  const enabled = entry.enabled === undefined ? DEFAULT_ROW.enabled : !!entry.enabled;
  return { enabled, freedom, consequence, privacyFloor };
}

/**
 * The full per-capability matrix the wizard renders: one row per (app × atom × noun) capability of the
 * ENABLED apps, merged with the admin `template`. Rows carry the resolved freedom/consequence + the
 * implementing `opId` (or null = declared-but-unimplemented).
 *
 * @param {Array<{manifest:object}>} sources
 * @param {object} [opts]
 * @param {Set<string>|string[]|null} [opts.enabledApps]  apps enabled in the circle (null = all)
 * @param {object} [opts.template]  `{ "<app> <atom> <noun>": { enabled?, freedom?, consequence?, privacyFloor? } }`
 * @returns {Array<{key,app,atom,noun,opId,enabled,freedom,consequence,privacyFloor}>}
 */
export function buildCapabilityMatrix(sources, { enabledApps = null, template = {} } = {}) {
  const rows = [];
  const tmpl = (template && typeof template === 'object') ? template : {};
  for (const src of (Array.isArray(sources) ? sources : [])) {
    const manifest = src?.manifest;
    const app = manifest?.app;
    if (!app || !isAppEnabled(app, enabledApps)) continue;
    for (const cap of capabilitiesOf(manifest)) {
      const key = capabilityKey(app, cap.atom, cap.noun);
      rows.push({ key, app, atom: cap.atom, noun: cap.noun, opId: cap.opId, ...resolveRow(tmpl[key]) });
    }
  }
  return rows;
}

/**
 * The narrowed capability KEY SET the Slice-1 gate authorises: every enabled-app capability whose
 * matrix row is `enabled` (admin didn't disable it). This is what makes the gate drop below app-level.
 * @returns {Set<string>}
 */
export function effectiveCapabilityKeys(sources, opts = {}) {
  const keys = new Set();
  for (const row of buildCapabilityMatrix(sources, opts)) {
    if (row.enabled) keys.add(row.key);
  }
  return keys;
}

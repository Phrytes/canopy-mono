/**
 * appStateBridge — connect React Native's AppState to the live
 * agent's online cadence.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 * Foreground: agent stays connected, polls at `pollIntervalMs`.
 * Background: agent disconnects from relay, drains, sleeps.
 * `expo-task-manager` (Phase 40.21) brings it back periodically per
 * `onlineWindow.everyMinutes`.
 *
 * The pure cadence helper lives in `lib/activeCadence.js`; this
 * module wires it to a live bundle.
 */

import { AppState } from 'react-native';
import { createActiveCadence } from './activeCadence.js';

/**
 * Attach an AppState listener that drives the bundle's cache online
 * state. Returns a cleanup function.
 *
 * @param {object} args
 * @param {object} args.bundle           the active agent bundle
 * @param {() => number} [args.getPollIntervalMs]
 *   Reads the current `pollIntervalMs` from settings; defaults to 5000.
 * @param {(err: unknown) => void} [args.onError]
 * @param {object} [args.AppStateModule] inject for tests; defaults to RN's `AppState`.
 *
 * @returns {() => void}   cleanup
 */
export function attachAppStateBridge({
  bundle,
  getPollIntervalMs,
  onError,
  AppStateModule = AppState,
} = {}) {
  if (!bundle?.agent) {
    if (onError) onError(new Error('attachAppStateBridge: bundle.agent required'));
    return () => {};
  }
  const runOnce = async () => {
    // Foreground tick: invoke a soft refresh on the bundle.
    // The bundle exposes `agent` + `skillMatch`; we ping skillMatch
    // (lightweight subscription health-check).  Apps that need a
    // heavier sync can override via the bundle's runOnce hook.
    try {
      if (typeof bundle.skillMatch?.tick === 'function') {
        await bundle.skillMatch.tick();
      }
    } catch (err) {
      if (onError) onError(err);
    }
  };

  const cadence = createActiveCadence({
    runOnce,
    getPollIntervalMs,
    AppState: AppStateModule,
    onError,
  });

  // Drive the bundle's online state on AppState change.
  const sub = AppStateModule.addEventListener('change', (next) => {
    const isForeground = next === 'active';
    try {
      if (typeof bundle.cache?.setOnline === 'function') {
        bundle.cache.setOnline(isForeground);
      }
    } catch (err) {
      if (onError) onError(err);
    }
  });

  cadence.start();

  return () => {
    cadence.stop();
    sub?.remove?.();
  };
}

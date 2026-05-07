/**
 * geo (mobile) — `getCoarseLocationFromGps` powered by `expo-location`.
 *
 * Stoop V3 Phase 40.7 (2026-05-08).
 *
 * Mobile counterpart to `apps/stoop/src/lib/geo.js`'s same-named stub.
 * Stoop's web-side geo lives in the desktop app and throws when
 * called; the RN client provides the real implementation here.
 *
 * Permissions are requested on first call. The classifier
 * (`expo-location.requestForegroundPermissionsAsync`) returns
 * `{ status: 'granted' | 'denied' | 'undetermined' }`. Anything other
 * than `granted` triggers a `code: 'PERMISSION_DENIED'` throw the UI
 * can branch on.
 *
 * Output shape matches the desktop stub's contract:
 *   `{ cell, label: null, source: 'gps' }`.
 *
 * The cell helpers (`cellFor`, `cellCenter`, `distanceKm`, `snapToGrid`,
 * `DISTANCE_PRESETS`, `GEO_DEFAULTS`) come from `@canopy-app/stoop/lib/geo`
 * — same source, same grid, same labels — so cells produced on the
 * phone collide bit-for-bit with cells produced on the laptop.
 */

import * as Location from 'expo-location';
import {
  cellFor,
  cellCenter,
  distanceKm,
  snapToGrid,
  DISTANCE_PRESETS,
  GEO_DEFAULTS,
} from '@canopy-app/stoop/lib/geo';

export { cellFor, cellCenter, distanceKm, snapToGrid, DISTANCE_PRESETS, GEO_DEFAULTS };

/**
 * Resolve the user's current coarse location.
 *
 * @param {object} [opts]
 * @param {number} [opts.gridM]         grid edge in metres (default: GEO_DEFAULTS.gridM)
 * @param {string} [opts.accuracy]      `'low'` (default) | `'balanced'` | `'high'`
 * @param {number} [opts.timeoutMs]     timeout for the `getCurrentPositionAsync` call
 * @param {object} [opts.LocationModule] inject for tests; defaults to `expo-location`
 * @returns {Promise<{cell: string, label: null, source: 'gps', lat: number, lng: number}>}
 *
 * @throws Error with `code: 'PERMISSION_DENIED'` if the user rejected the prompt
 * @throws Error with `code: 'LOCATION_UNAVAILABLE'` if the device couldn't get a fix
 */
export async function getCoarseLocationFromGps({
  gridM        = GEO_DEFAULTS.gridM,
  accuracy     = 'low',
  timeoutMs    = 15000,
  LocationModule = Location,
} = {}) {
  const perm = await LocationModule.requestForegroundPermissionsAsync();
  if (perm?.status !== 'granted') {
    const err = new Error('Location permission not granted');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  const accuracyEnum = _resolveAccuracy(LocationModule, accuracy);

  let pos;
  try {
    pos = await LocationModule.getCurrentPositionAsync({
      accuracy:    accuracyEnum,
      timeInterval: timeoutMs,
    });
  } catch (cause) {
    const err = new Error('Could not obtain a GPS fix');
    err.code  = 'LOCATION_UNAVAILABLE';
    err.cause = cause;
    throw err;
  }

  const lat = pos?.coords?.latitude;
  const lng = pos?.coords?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    const err = new Error('Location response had no coordinates');
    err.code  = 'LOCATION_UNAVAILABLE';
    throw err;
  }

  return {
    cell:   cellFor({ lat, lng, gridM }),
    label:  null,
    source: 'gps',
    lat,
    lng,
  };
}

function _resolveAccuracy(LocationModule, key) {
  const map = {
    low:      LocationModule?.Accuracy?.Low      ?? 1,
    balanced: LocationModule?.Accuracy?.Balanced ?? 3,
    high:     LocationModule?.Accuracy?.High     ?? 4,
  };
  return map[key] ?? map.low;
}

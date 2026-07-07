/**
 * Tasks V1 Settings — per-app schema bound to the
 * `@canopy/local-store` `createSettingsModule` factory.
 *
 * The factory enforces the project-wide split:
 *
 *   <pod>/tasks/settings/shared.json              user-portable
 *   <pod>/tasks/settings/devices/<deviceId>.json  per-install
 *
 * (See `Project Files/conventions/cross-app-settings.md`.)
 *
 * Tasks V1 splits its tunables as follows:
 *
 *   shared (user-portable):
 *     - `pushPreferences`        — per-event opt-out / louder / quieter
 *     - `cadenceOverrides`       — per-event cadence override (user > circle > app)
 *     - `defaultCalendarShared`  — bool; whether calendar-conflict view is enabled
 *
 *   device (per-install):
 *     - `pollIntervalMs`         — how often the local-store cadence ticks
 *     - `localModeRoot`          — local-mode storage root path (CLI only)
 *
 * Apps consume the module's exports directly:
 *
 *     import { loadSettings, updateSettings } from './storage/settings.js';
 *     const s = await loadSettings({ dataSource, deviceId });
 *     await updateSettings({ dataSource, deviceId, patch: { pollIntervalMs: 5000 } });
 */

import { createSettingsModule } from '@canopy/local-store';

const SHARED_FIELDS = ['pushPreferences', 'cadenceOverrides', 'defaultCalendarShared'];
const DEVICE_FIELDS = ['pollIntervalMs', 'localModeRoot'];

const DEFAULTS = {
  // shared
  pushPreferences:       {},        // {[eventName]: 'inbox' | 'push' | 'silent'}
  cadenceOverrides:      {},        // {[eventName]: { leadMs?, suppressed? }}
  defaultCalendarShared: false,
  // device
  pollIntervalMs:        15_000,
  localModeRoot:         null,      // null = use platform-default (~/.tasks)
};

function _validate(value, fieldName, def) {
  // Special-case the int field: enforce a sane floor.
  if (fieldName === 'pollIntervalMs') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 100) {
      return def;
    }
    return value;
  }
  // localModeRoot may be string or null.
  if (fieldName === 'localModeRoot') {
    if (value === null) return null;
    if (typeof value === 'string' && value.length > 0) return value;
    return def;
  }
  // Default: type-equality to the default.
  if (value === undefined || value === null) return def;
  if (typeof value !== typeof def) return def;
  // Object fields: shallow-copy to avoid frozen-defaults issues.
  if (typeof def === 'object' && def !== null) return { ...value };
  return value;
}

const _module = createSettingsModule({
  appId:        'tasks',
  sharedFields: SHARED_FIELDS,
  deviceFields: DEVICE_FIELDS,
  defaults:     DEFAULTS,
  fieldValidator: _validate,
});

export const {
  loadSettings,
  saveSettings,
  updateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SHARED_PATH,
  SETTINGS_DEVICE_PATH_PREFIX,
  SETTINGS_LEGACY_PATH,
  SETTINGS_MIGRATION_MARKER,
} = _module;

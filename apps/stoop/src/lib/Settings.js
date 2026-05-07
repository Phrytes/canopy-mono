/**
 * Settings — Stoop V2 Phase 23.5 (2026-05-07), V2.5 Phase 33 (2026-05-06).
 *
 * Persists user-tunable settings via the same `CachingDataSource`
 * write-through path as MemberMap and items.
 *
 * V2.5 Phase 33 splits the legacy single blob into two:
 *
 *   `mem://stoop/settings/shared.json`              — user-portable.
 *      Travels with the user across every device of theirs.
 *      Fields: broadcastable, defaultShareLocation.
 *
 *   `mem://stoop/settings/devices/<deviceId>.json`  — per-device.
 *      Stays local to the install (one blob per deviceId).
 *      Fields: pollIntervalMs, onlineWindow, allowHopThrough.
 *
 * Why split: poll cadence + relay-for-others + mobile online-window
 * are device decisions (battery, network, hardware).  Sharing those
 * across devices via the pod actively wrong; a phone shouldn't
 * inherit a desktop's 2-second poll.  But "broadcast me to others"
 * and "share location by default with new contacts" are *user*
 * preferences and SHOULD follow them everywhere.
 *
 * Legacy `mem://stoop/settings.json` blobs are migrated on first read
 * (idempotent — a one-shot marker key prevents re-runs).
 *
 * **Substrate candidate** (rule-of-two): when a 2nd app needs
 * battery-aware settings, lift this + the per-platform schedulers
 * into `@canopy/online-cadence`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

const SHARED_PATH         = 'mem://stoop/settings/shared.json';
const LEGACY_PATH         = 'mem://stoop/settings.json';
const MIGRATION_MARKER    = 'mem://stoop/settings/.migrated-from-v2';

function devicePathFor(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return null;
  return `mem://stoop/settings/devices/${deviceId}.json`;
}

/**
 * Field partition.  Add new fields in DEFAULT_SETTINGS, then list them
 * here so the loader knows where to send each piece of state.
 *
 * Anything in DEFAULT_SETTINGS that is NOT in either set is treated as
 * shared (safer default — pod-portable preferences won't accidentally
 * leak as device-only state).
 */
const DEVICE_FIELDS = Object.freeze(
  new Set(['pollIntervalMs', 'onlineWindow', 'allowHopThrough']),
);
const SHARED_FIELDS = Object.freeze(
  new Set(['broadcastable', 'defaultShareLocation']),
);

/** Default settings.  Conservative — opt-in for everything privacy/battery-relevant. */
export const DEFAULT_SETTINGS = Object.freeze({
  // ── Per-device ────────────────────────────────────────────────────
  // How often the board pulls open posts (web honoured; mobile V3
  // overlays 300_000 = 5 min via the same skill).
  pollIntervalMs: 2_000,
  // Mobile-only (V3 binds to expo-task-manager).  Web ignores both.
  onlineWindow: { everyMinutes: null, durationSec: null },
  // Global hop-through toggle.  When false, this device never relays
  // for anyone — overrides per-contact `allowHopThrough`.
  allowHopThrough: false,

  // ── User-portable (synced across all devices via the pod) ─────────
  // Accept inbound auto-skillmatch hints from non-trusted contacts?
  broadcastable: true,
  // When you add a new contact, should `shareLocation` default to true?
  defaultShareLocation: false,
});

/**
 * Read merged settings from `dataSource`.  Cold-boot returns a
 * `DEFAULT_SETTINGS` clone.
 *
 * @param {object} args
 * @param {{read: Function, write?: Function, delete?: Function}} args.dataSource
 * @param {string|null} [args.deviceId]
 *   When present, reads both the shared blob AND
 *   `devices/<deviceId>.json`, merging device fields over shared.
 *   When absent (legacy callers), only the shared blob is read.
 * @returns {Promise<object>}
 */
export async function loadSettings({ dataSource, deviceId = null }) {
  if (!dataSource?.read) return { ...DEFAULT_SETTINGS };

  // One-shot migration of any legacy `mem://stoop/settings.json` blob
  // before we read the new layout.  Idempotent.
  if (deviceId) await _migrateLegacyIfPresent({ dataSource, deviceId });

  const [shared, device] = await Promise.all([
    _safeReadJson(dataSource, SHARED_PATH),
    deviceId ? _safeReadJson(dataSource, devicePathFor(deviceId)) : Promise.resolve(null),
  ]);

  // Build the merged view.  Shared overlays defaults; device overlays
  // shared (device fields take priority by definition).
  return mergeWithDefaults({ ...(shared ?? {}), ...(device ?? {}) });
}

/**
 * Write the partitioned settings to `dataSource`.  Returns the
 * (defaults-merged) settings.  When `deviceId` is present, splits the
 * blob across shared + device files; when null, falls back to the
 * legacy single-blob layout for back-compat.
 *
 * @param {object} args
 * @param {{write: Function}} args.dataSource
 * @param {string|null} [args.deviceId]
 * @param {object} args.settings
 */
export async function saveSettings({ dataSource, deviceId = null, settings }) {
  if (!dataSource?.write) return mergeWithDefaults(settings);
  const merged = mergeWithDefaults(settings);

  if (!deviceId) {
    // Legacy single-blob path — kept for tests that don't carry a
    // deviceId.  Production callers (Agent.js) always pass deviceId.
    await dataSource.write(LEGACY_PATH, JSON.stringify(merged));
    return merged;
  }

  const sharedSubset = _partition(merged, SHARED_FIELDS);
  const deviceSubset = _partition(merged, DEVICE_FIELDS);

  await Promise.all([
    dataSource.write(SHARED_PATH, JSON.stringify(sharedSubset)),
    dataSource.write(devicePathFor(deviceId), JSON.stringify(deviceSubset)),
  ]);
  return merged;
}

/**
 * Patch a subset of settings.  Auto-routes each patched field to its
 * scope (device vs. shared) via the field-name partition above; an
 * explicit `scope` argument overrides the auto-routing for the whole
 * patch.  Returns the updated full settings.
 *
 * @param {object} args
 * @param {{read: Function, write: Function}} args.dataSource
 * @param {string|null} [args.deviceId]
 * @param {Partial<object>} args.patch
 * @param {'device'|'shared'} [args.scope]   force every patched field into one bucket
 */
export async function updateSettings({ dataSource, deviceId = null, patch, scope = null }) {
  const current = await loadSettings({ dataSource, deviceId });
  const next = { ...current, ...patch };
  // Special-case nested onlineWindow merge so a partial patch doesn't
  // wipe the other field.
  if (patch?.onlineWindow && typeof patch.onlineWindow === 'object') {
    next.onlineWindow = { ...current.onlineWindow, ...patch.onlineWindow };
  }

  // `scope` is honoured by partitioning the merged result into the
  // requested bucket and writing only that one (the other bucket
  // keeps its prior content).
  if (scope === 'device' || scope === 'shared') {
    return _saveScoped({ dataSource, deviceId, settings: next, scope });
  }
  return saveSettings({ dataSource, deviceId, settings: next });
}

// ── Internals ────────────────────────────────────────────────────────────────

async function _safeReadJson(dataSource, path) {
  if (!path) return null;
  try {
    const raw = await dataSource.read(path);
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function _partition(merged, allowedFields) {
  const out = {};
  for (const k of Object.keys(merged)) {
    if (allowedFields.has(k)) out[k] = merged[k];
  }
  return out;
}

async function _saveScoped({ dataSource, deviceId, settings, scope }) {
  const merged = mergeWithDefaults(settings);
  if (!deviceId) {
    // Legacy path: any forced scope just writes the single blob.
    await dataSource.write(LEGACY_PATH, JSON.stringify(merged));
    return merged;
  }
  if (scope === 'device') {
    await dataSource.write(devicePathFor(deviceId),
      JSON.stringify(_partition(merged, DEVICE_FIELDS)));
  } else {
    await dataSource.write(SHARED_PATH,
      JSON.stringify(_partition(merged, SHARED_FIELDS)));
  }
  return merged;
}

/**
 * Phase 33.3 — one-shot migration from legacy `mem://stoop/settings.json`.
 * Reads the legacy blob (if any), partitions it across the new shared +
 * device layouts, writes the partitioned blobs, deletes the legacy one,
 * and marks the migration so subsequent loads skip the work.
 */
async function _migrateLegacyIfPresent({ dataSource, deviceId }) {
  if (!dataSource?.read || !dataSource?.write) return;
  // Marker check first — almost all calls land here.
  const marker = await _safeReadJson(dataSource, MIGRATION_MARKER);
  if (marker && marker.done === true) return;

  const legacy = await _safeReadJson(dataSource, LEGACY_PATH);
  if (legacy != null) {
    const merged = mergeWithDefaults(legacy);
    await Promise.all([
      dataSource.write(SHARED_PATH,
        JSON.stringify(_partition(merged, SHARED_FIELDS))),
      dataSource.write(devicePathFor(deviceId),
        JSON.stringify(_partition(merged, DEVICE_FIELDS))),
    ]);
    if (typeof dataSource.delete === 'function') {
      try { await dataSource.delete(LEGACY_PATH); } catch { /* best-effort */ }
    }
  }
  await dataSource.write(MIGRATION_MARKER, JSON.stringify({ done: true, at: Date.now() }));
}

function mergeWithDefaults(s) {
  if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    pollIntervalMs:
      typeof s.pollIntervalMs === 'number' && s.pollIntervalMs >= 100
        ? s.pollIntervalMs
        : DEFAULT_SETTINGS.pollIntervalMs,
    onlineWindow: {
      everyMinutes:
        typeof s.onlineWindow?.everyMinutes === 'number' && s.onlineWindow.everyMinutes > 0
          ? s.onlineWindow.everyMinutes
          : null,
      durationSec:
        typeof s.onlineWindow?.durationSec === 'number' && s.onlineWindow.durationSec > 0
          ? s.onlineWindow.durationSec
          : null,
    },
    broadcastable:        s.broadcastable === false ? false : true,
    allowHopThrough:      s.allowHopThrough === true,
    defaultShareLocation: s.defaultShareLocation === true,
  };
}

// Path constants exported for tests + cross-app pod-layout doc.
export const SETTINGS_SHARED_PATH = SHARED_PATH;
export const SETTINGS_DEVICE_PATH_PREFIX = 'mem://stoop/settings/devices/';
export const SETTINGS_LEGACY_PATH = LEGACY_PATH;
export const SETTINGS_MIGRATION_MARKER = MIGRATION_MARKER;
/** @deprecated since Phase 33 — use `SETTINGS_SHARED_PATH` (or SETTINGS_LEGACY_PATH for migration tooling). */
export const SETTINGS_STORAGE_PATH = SHARED_PATH;

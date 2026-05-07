/**
 * Settings — Stoop V2 Phase 23.5 (2026-05-07).
 *
 * Per-bundle user-tunable settings (cadence, hop, broadcastable,
 * default share-location flag).  Persisted via the same
 * `CachingDataSource` write-through path as MemberMap and items —
 * write to `mem://stoop/settings.json`, sync to
 * `<pod>/stoop/settings.json` when a pod is attached.
 *
 * Functional design § 4g defines the field set; this module is the
 * load / save plumbing.  The `getSettings` / `updateSettings` skills
 * (in `apps/stoop/src/skills/index.js`) compose this lib.
 *
 * Design choices:
 * - **Defaults are conservative**: `allowHopThrough: false`,
 *   `broadcastable: true`, no hard `onlineWindow` (web is always-on,
 *   mobile binds to expo-task-manager in V3).  V2 users opt *into*
 *   relaying for others; V1 stays unchanged.
 * - **No event emitter** in V2 — settings are read on demand by the
 *   consuming code paths.  When V3 mobile needs reactive cadence,
 *   we add an Emitter.  For now, simpler.
 *
 * **Substrate candidate** (rule-of-two): when a 2nd app needs
 * battery-aware settings, lift this + the per-platform schedulers
 * into `@canopy/online-cadence`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

const SETTINGS_PATH = 'mem://stoop/settings.json';

/** Default settings.  Conservative — opt-in for everything privacy/battery-relevant. */
export const DEFAULT_SETTINGS = Object.freeze({
  // How often the board pulls open posts (web honoured; mobile
  // V3 will overlay 300_000 = 5 min via the same skill).
  pollIntervalMs: 2_000,
  // Mobile-only (V3 binds to expo-task-manager).  Web ignores both fields.
  onlineWindow: { everyMinutes: null, durationSec: null },
  // Accept inbound auto-skillmatch hints from non-trusted contacts?
  broadcastable: true,
  // Global hop-through toggle.  When false, this device never relays
  // for anyone — overrides per-contact `allowHopThrough`.
  allowHopThrough: false,
  // When you add a new contact, should `shareLocation` default to true?
  defaultShareLocation: false,
});

/**
 * Read the settings blob from `dataSource`.  Cold-boot returns the
 * `DEFAULT_SETTINGS` clone.
 *
 * @param {object} args
 * @param {{read: Function}} args.dataSource
 * @returns {Promise<object>}
 */
export async function loadSettings({ dataSource }) {
  if (!dataSource?.read) return { ...DEFAULT_SETTINGS };
  try {
    const raw = await dataSource.read(SETTINGS_PATH);
    if (raw == null) return { ...DEFAULT_SETTINGS };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Write the settings blob to `dataSource`.  Returns the written
 * settings (after defaults-merging).
 *
 * @param {object} args
 * @param {{write: Function}} args.dataSource
 * @param {object} args.settings
 */
export async function saveSettings({ dataSource, settings }) {
  if (!dataSource?.write) return mergeWithDefaults(settings);
  const merged = mergeWithDefaults(settings);
  await dataSource.write(SETTINGS_PATH, JSON.stringify(merged));
  return merged;
}

/**
 * Patch a subset of settings.  Returns the updated full settings.
 *
 * @param {object} args
 * @param {{read: Function, write: Function}} args.dataSource
 * @param {Partial<object>} args.patch
 */
export async function updateSettings({ dataSource, patch }) {
  const current = await loadSettings({ dataSource });
  const next = { ...current, ...patch };
  // Special-case nested onlineWindow merge so a partial patch
  // doesn't wipe the other field.
  if (patch?.onlineWindow && typeof patch.onlineWindow === 'object') {
    next.onlineWindow = { ...current.onlineWindow, ...patch.onlineWindow };
  }
  return saveSettings({ dataSource, settings: next });
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

export const SETTINGS_STORAGE_PATH = SETTINGS_PATH;

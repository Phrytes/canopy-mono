/**
 * cadence — resolve effective notification cadence per event.
 *
 * Three layers, narrowest wins:
 *
 *   1. **App baseline** — hardcoded sane defaults so a fresh crew
 *      with no config + no user overrides still works.
 *   2. **Crew default** — `crewConfig.cadences[<eventType>]`. Editable
 *      by admin/coord via `setCrewCadences`.
 *   3. **User override** — `userSettings.cadenceOverrides[<eventType>]`.
 *      Editable per user via `setMyCadenceOverrides`.
 *
 * Each level may set:
 *   - `channel`:  'inbox' | 'push' | 'silent'
 *                 (V1 ships only `inbox`; `push` is a V1.5 flag)
 *   - `suppressed`: bool — drop the event entirely
 *   - `leadMs`:   number — for `missed-deadline` ONLY: how long
 *                 before `dueAt` to fire (default: 0 = at the
 *                 deadline). `missed-deadline-30min` style.
 *
 * Pure function — no I/O. Apps fetch the layers and call
 * `resolveCadence({eventType, baseline, crew, user})` to get the
 * effective config.
 */

/**
 * Hardcoded baseline. Apps that want different baselines wrap
 * this module + provide their own.
 */
export const BASELINE_CADENCES = Object.freeze({
  'missed-deadline': { channel: 'inbox', suppressed: false, leadMs: 0     },
  'task-completed':  { channel: 'inbox', suppressed: false                },
  'task-submitted':  { channel: 'inbox', suppressed: false                },
  'task-rejected':   { channel: 'inbox', suppressed: false                },
  'task-revoked':    { channel: 'inbox', suppressed: false                },
  'subtask-request': { channel: 'inbox', suppressed: false                },
});

const VALID_CHANNELS = new Set(['inbox', 'push', 'silent']);

/**
 * Resolve effective cadence for one event type.
 *
 * @param {object} args
 * @param {string} args.eventType
 * @param {object} [args.baseline]   defaults to BASELINE_CADENCES
 * @param {object} [args.crew]       crewConfig.cadences (per-event map)
 * @param {object} [args.user]       userSettings.cadenceOverrides (per-event map)
 * @returns {{channel: string, suppressed: boolean, leadMs: number}}
 */
export function resolveCadence({ eventType, baseline, crew, user } = {}) {
  if (typeof eventType !== 'string' || !eventType) {
    throw new TypeError('resolveCadence: eventType required');
  }
  const layers = [
    BASELINE_CADENCES[eventType] ?? {},
    (baseline ?? {})[eventType]  ?? {},
    (crew ?? {})[eventType]      ?? {},
    (user ?? {})[eventType]      ?? {},
  ];
  const merged = { channel: 'inbox', suppressed: false, leadMs: 0 };
  for (const layer of layers) {
    if (typeof layer.channel === 'string' && VALID_CHANNELS.has(layer.channel)) {
      merged.channel = layer.channel;
    }
    if (typeof layer.suppressed === 'boolean') merged.suppressed = layer.suppressed;
    if (Number.isFinite(layer.leadMs) && layer.leadMs >= 0) merged.leadMs = layer.leadMs;
  }
  return merged;
}

/**
 * Validate a cadence-config map shape. Returns a sanitised copy
 * (drops bad entries) — used by `setCrewCadences` /
 * `setMyCadenceOverrides` skills before persisting.
 */
export function sanitiseCadenceMap(map) {
  if (!map || typeof map !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof k !== 'string' || !k) continue;
    if (!v || typeof v !== 'object') continue;
    const entry = {};
    if (typeof v.channel === 'string' && VALID_CHANNELS.has(v.channel)) entry.channel = v.channel;
    if (typeof v.suppressed === 'boolean') entry.suppressed = v.suppressed;
    if (Number.isFinite(v.leadMs) && v.leadMs >= 0) entry.leadMs = v.leadMs;
    if (Object.keys(entry).length > 0) out[k] = entry;
  }
  return out;
}

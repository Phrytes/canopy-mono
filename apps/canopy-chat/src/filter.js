/**
 * canopy-chat — thread filter DSL.
 *
 * Each thread (per design choice D) has an explicit filter that
 * decides which inbound events (notifier output, item-changed events,
 * skill-reply async completions) get routed to it.
 *
 * Filter shape (v0.2):
 *
 *   {
 *     apps?:       string[],    // ['household']            ['*']      ['*']
 *     eventTypes?: string[],    // ['notification','reminder']
 *     actors?:     string[],    // webids of actors whose events to include
 *   }
 *
 * Semantics:
 *   - Each key is independent — combined with AND (event must satisfy
 *     every specified key).
 *   - Within a key, values are OR-combined (event matches if it equals
 *     ANY of the listed values).
 *   - Key absent / undefined / empty-array → wildcard for that dimension.
 *   - The special token '*' inside any array also acts as a wildcard
 *     for that dimension (convenience).
 *
 * Phase v0.2 sub-slice 2.2 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} ThreadFilter
 * @property {string[]} [apps]
 * @property {string[]} [eventTypes]
 * @property {string[]} [actors]
 */

/**
 * @typedef {object} Event
 * @property {string}              id
 * @property {number}              ts
 * @property {string}              app
 * @property {string}              type
 * @property {string}              [actor]
 * @property {{app: string, type: string, id: string}} [itemRef]
 * @property {*}                   [payload]
 */

/**
 * Returns true iff the event matches every specified key in the filter.
 *
 * @param {Event}        event
 * @param {ThreadFilter} [filter]   absent / null → wildcard everything
 * @returns {boolean}
 */
export function matchesFilter(event, filter) {
  if (!event || typeof event !== 'object') return false;
  if (!filter || typeof filter !== 'object') return true;

  if (!matchesKey(event.app,    filter.apps))       return false;
  if (!matchesKey(event.type,   filter.eventTypes)) return false;
  if (!matchesKey(event.actor,  filter.actors))     return false;
  return true;
}

/**
 * Per-key match.  Returns:
 *   - true when `allowed` is absent / null / [] / contains '*'
 *   - true when `allowed` includes `value`
 *   - false otherwise
 *
 * @param {string|undefined} value
 * @param {string[]|undefined} allowed
 * @returns {boolean}
 */
function matchesKey(value, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  if (allowed.includes('*'))   return true;
  // Defensive: empty actor/value should NOT match a non-wildcard list.
  if (value === undefined || value === null || value === '') return false;
  return allowed.includes(value);
}

/* ─── normalisation + introspection helpers ───────────────────────── */

/**
 * Normalise a user-supplied filter into a canonical shape suitable for
 * storage / serialisation: arrays sorted + de-duped; empty arrays
 * dropped.  Idempotent.
 *
 * @param {ThreadFilter} [filter]
 * @returns {ThreadFilter}
 */
export function normaliseFilter(filter) {
  if (!filter || typeof filter !== 'object') return {};
  const out = {};
  for (const key of ['apps', 'eventTypes', 'actors']) {
    const arr = filter[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const dedup = [...new Set(arr.map((v) => String(v)))].sort();
    out[key] = dedup;
  }
  return out;
}

/**
 * Returns true iff the filter is a wildcard (matches every event).
 * A filter is wildcard when every key is absent, empty, or contains '*'.
 *
 * @param {ThreadFilter} [filter]
 * @returns {boolean}
 */
export function isWildcardFilter(filter) {
  if (!filter || typeof filter !== 'object') return true;
  for (const key of ['apps', 'eventTypes', 'actors']) {
    const arr = filter[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    if (arr.includes('*')) continue;
    return false;
  }
  return true;
}

/**
 * Human-readable summary of a filter ('app:household, type:notification').
 * Useful for UI labels in the thread-list sidebar.
 *
 * @param {ThreadFilter} [filter]
 * @returns {string}
 */
export function describeFilter(filter) {
  if (isWildcardFilter(filter)) return '*';
  const parts = [];
  if (filter.apps?.length)       parts.push(`app:${filter.apps.join('|')}`);
  if (filter.eventTypes?.length) parts.push(`type:${filter.eventTypes.join('|')}`);
  if (filter.actors?.length)     parts.push(`actor:${filter.actors.join('|')}`);
  return parts.join(', ');
}

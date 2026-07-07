/**
 * Canonical storage-function names — the vocabulary the substrate
 * understands by default.
 *
 * Apps can register additional names at runtime via
 * `podRouting.registerStorageFunction(name)`. The registry is a
 * label hint only; resolution itself is purely pattern-driven on
 * the mapping table.
 *
 * See functional design §4.3.1.
 */

export const CANONICAL_STORAGE_FUNCTIONS = Object.freeze([
  'private/identity-vault',
  'private/state',          // patterned: 'private/state/<app>'
  'private/drafts',         // patterned: 'private/drafts/<app>'
  'sharing/profile-public',
  'sharing',                // patterned: 'sharing/<resource>'
  'group',                  // patterned: 'group/<circleId>/<container>'
  'personal-in-group',      // patterned: 'personal-in-group/<circleId>'
]);

/**
 * Find the mapping entry that matches `storageFn` against `mappings`
 * (an object of `pattern → uri`). Returns `{pattern, uri, tail}` or
 * `null` if nothing matches.
 *
 * Match priority:
 *   1. Exact match (highest priority).
 *   2. Longest-prefix glob match (`<prefix>/*` style).
 */
export function matchMapping(storageFn, mappings) {
  if (typeof storageFn !== 'string' || storageFn.length === 0) return null;
  if (!mappings || typeof mappings !== 'object') return null;

  if (Object.prototype.hasOwnProperty.call(mappings, storageFn)) {
    return { pattern: storageFn, uri: mappings[storageFn], tail: '' };
  }

  let best = null;
  let bestPrefixLen = -1;
  for (const pattern of Object.keys(mappings)) {
    if (!pattern.endsWith('/*')) continue;
    const prefix = pattern.slice(0, -1);   // 'sharing/*' → 'sharing/'
    if (storageFn.startsWith(prefix) && prefix.length > bestPrefixLen) {
      best = { pattern, uri: mappings[pattern], tail: storageFn.slice(prefix.length) };
      bestPrefixLen = prefix.length;
    }
  }
  return best;
}

/**
 * Substitute `<varname>` placeholders in a template string from a
 * vars object. Leaves unknown placeholders as-is so callers can spot
 * misconfiguration.
 */
export function substituteVars(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/<([^>]+)>/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/**
 * Concatenate a base URI with a tail path. Normalises the slash so
 * `'…/sharing/' + 'tasks/abc'` yields `'…/sharing/tasks/abc'`.
 */
export function joinUriTail(base, tail) {
  if (!tail) return base;
  if (base.endsWith('/')) return base + tail;
  return base + '/' + tail;
}

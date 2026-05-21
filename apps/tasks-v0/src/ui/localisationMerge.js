/**
 * localisationMerge — merge a shell-local locale bundle with the shared
 * `apps/tasks-v0/locales/shared/<lang>.json`.
 *
 * Phase 41.18 follow-up (2026-05-10) — created alongside the
 * `apps/tasks-v0/locales/shared/` foundation per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Both shells consume from here:
 *   - `apps/tasks-v0/web/app.js`                    (eventually — when migrating
 *                                                    inline status labels to keys)
 *   - `apps/tasks-mobile/src/LocalisationProvider.js`        (mobile — wraps useLocalisation)
 *
 * The shape of every locale leaf is `{text, doc}` — see
 * `Project Files/conventions/localisation.md`. The merge is
 * shallow-deep: shell-local keys at the same path WIN, so a shell
 * can override a shared label if it really needs to.
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module.
 */

/**
 * Deep-merge a shell-local bundle on top of a shared bundle.
 *
 * @param {object} shared      JSON-shaped shared bundle (e.g.
 *                             `apps/tasks-v0/locales/shared/en.json`)
 * @param {object} shellLocal  shell's own bundle (e.g.
 *                             `apps/tasks-mobile/locales/en.json`)
 * @returns {object}           merged bundle
 */
export function mergeLocales(shared, shellLocal) {
  if (!shared || typeof shared !== 'object') return shellLocal ?? {};
  if (!shellLocal || typeof shellLocal !== 'object') return shared;
  return _deepMerge(shared, shellLocal);
}

function _deepMerge(a, b) {
  // `b` wins on leaf collisions. Both `a` and `b` are plain objects.
  if (a == null || typeof a !== 'object' || Array.isArray(a)) return b;
  if (b == null || typeof b !== 'object' || Array.isArray(b)) return b ?? a;
  // Locale leaf shape: `{text, doc}`. Treat as a leaf, not a container.
  if ('text' in b && typeof b.text === 'string') return b;
  if ('text' in a && typeof a.text === 'string') return b;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = (k in a) ? _deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}

/**
 * Look up a leaf by dotted path. Returns the leaf's `text` (or the
 * fallback if missing).
 *
 * @param {object} bundle      merged bundle
 * @param {string} path        e.g. 'shared.status.claimed' or 'mobile.welcome.create_cta'
 * @param {string} [fallback]  returned when the leaf is absent
 * @returns {string}
 */
export function lookupKey(bundle, path, fallback = '') {
  if (typeof path !== 'string' || !path) return fallback;
  const parts = path.split('.');
  let cur = bundle;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return fallback;
    cur = cur[p];
  }
  if (cur && typeof cur === 'object' && typeof cur.text === 'string') return cur.text;
  if (typeof cur === 'string') return cur;
  return fallback;
}

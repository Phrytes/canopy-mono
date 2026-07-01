/**
 * settings — read helpers over `manifest.settings` (B · Slice 2, ruling Q1).
 *
 * The declaration is validated in `validate.js`; this module is the shared read layer the creation
 * wizard + inline settings forms (web AND mobile) consume, so the `requiredWhen` resolution and the
 * scope split live ONCE. `scope:'circle'` settings are the admin template; `scope:'user'` settings
 * are member preferences (the two-level `admin-template ∩ member-prefs` resolution lands in Slice 4).
 */

/** The declared settings, optionally filtered to a `scope` ('circle' default when a setting omits it). */
export function settingsOf(manifest, { scope } = {}) {
  const all = Array.isArray(manifest?.settings) ? manifest.settings : [];
  return scope ? all.filter((s) => (s?.scope ?? 'circle') === scope) : all;
}

/** `{ key: default }` for every setting (in `scope`) that declares a default — seeds a wizard/form. */
export function settingDefaults(manifest, opts = {}) {
  const out = {};
  for (const s of settingsOf(manifest, opts)) {
    if (s && s.key != null && s.default !== undefined) out[s.key] = s.default;
  }
  return out;
}

/**
 * Resolve `requiredWhen`: a setting is required iff EVERY named sibling in `values` matches its
 * allowed value (or one of an allowed array). No `requiredWhen` → never conditionally-required.
 * @param {object} setting  a Setting declaration
 * @param {object} [values] the current form values (sibling keys → chosen values)
 * @returns {boolean}
 */
export function isSettingRequired(setting, values = {}) {
  const rw = setting?.requiredWhen;
  if (!rw || typeof rw !== 'object' || Array.isArray(rw)) return false;
  const keys = Object.keys(rw);
  if (keys.length === 0) return false;
  return keys.every((k) => {
    const allowed = rw[k];
    const v = values?.[k];
    return Array.isArray(allowed) ? allowed.includes(v) : v === allowed;
  });
}

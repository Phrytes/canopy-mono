/**
 * Default-bundle picker.
 *
 * Multiple installed bundles can register a renderer for the same
 * `type` (e.g. two Tasks bundles, two note apps). The OS owns
 * conflict resolution — on Android that's the "default app for type"
 * picker UI; on desktop it's a CLI flag or config setting.
 *
 * The substrate just **records** which bundle is the current default
 * for each type, with the registered set kept side-by-side for the
 * UI to surface (re-pick, etc.).
 *
 * V0 picks the most recently registered bundle when no explicit
 * default is set — best-effort first-write-wins behaviour for a
 * single-bundle install.
 *
 * Standardisation Phase 52.12.4.
 */

/**
 * Create a default-picker state holder.
 *
 * @returns {{
 *   setDefault: (type: string, bundleId: string) => void,
 *   clearDefault: (type: string) => void,
 *   getDefault: (type: string) => string | null,
 *   getAll: () => Object<string, string>,
 * }}
 */
export function createDefaultPicker() {
  const defaults = new Map();   // type → bundleId

  return {
    setDefault(type, bundleId) {
      if (typeof type !== 'string' || type.length === 0) {
        throw Object.assign(
          new Error('setDefault: type is required'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      if (typeof bundleId !== 'string' || bundleId.length === 0) {
        throw Object.assign(
          new Error('setDefault: bundleId is required'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      defaults.set(type, bundleId);
    },

    clearDefault(type) {
      defaults.delete(type);
    },

    getDefault(type) {
      return defaults.get(type) ?? null;
    },

    getAll() {
      return Object.fromEntries(defaults);
    },
  };
}

/**
 * @canopy/react-native/localisation — locale resolver substrate.
 *
 * Apps build a per-app resolver via `loadLocale({bundles, defaultLang})`
 * and consume `t()` / `format()` from the returned instance. See
 * `./loadLocale.js` for usage.
 *
 * The pure-fn `_lookupKey` is exposed via the resolver's `_internal`
 * for tests that need to assert on the lookup itself.
 */

export { loadLocale } from './loadLocale.js';

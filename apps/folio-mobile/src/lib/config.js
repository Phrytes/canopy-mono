/**
 * config.js — non-secret app config persisted to AsyncStorage.
 *
 * Pod root URLs aren't secret (the WebID derived from them is public),
 * so we keep them in AsyncStorage rather than expo-secure-store — same
 * pattern mesh-demo uses for its relay URL.  Secrets (tokens) live in
 * SecureStore, owned by `OidcSessionRN`.
 *
 * Test injection: every public function takes an optional `store`
 * argument; tests pass an in-memory map.  When `store` is `null` /
 * undefined we fall back to AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const POD_ROOT_KEY = 'folio-mobile:pod-root';

/**
 * Default folder name appended to `FileSystem.documentDirectory` to
 * give the engine a localRoot.  Same name the desktop CLI uses.
 */
export const DEFAULT_LOCAL_FOLDER = 'folio';

/**
 * Default Inrupt issuer for the SignIn flow.  Re-exported so callers
 * don't have to reach into folioAuth for a constant.
 */
export const DEFAULT_INRUPT_ISSUER = 'https://login.inrupt.com';

/**
 * @param {object|null} [store]
 * @returns {Promise<string|null>}
 */
export async function loadStoredPodRoot(store) {
  if (store && typeof store.get === 'function') return store.get(POD_ROOT_KEY) ?? null;
  try {
    const v = await AsyncStorage.getItem(POD_ROOT_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch { return null; }
}

/**
 * @param {object|null} store
 * @param {string} podRoot
 * @returns {Promise<void>}
 */
export async function savePodRoot(store, podRoot) {
  if (typeof podRoot !== 'string' || podRoot.length === 0) {
    throw new Error('savePodRoot: podRoot required');
  }
  const normalized = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  if (store && typeof store.set === 'function') {
    return store.set(POD_ROOT_KEY, normalized);
  }
  await AsyncStorage.setItem(POD_ROOT_KEY, normalized);
}

/**
 * @param {object|null} store
 * @returns {Promise<void>}
 */
export async function clearPodRoot(store) {
  if (store && typeof store.delete === 'function') return store.delete(POD_ROOT_KEY);
  await AsyncStorage.removeItem(POD_ROOT_KEY);
}

export const _CONFIG_KEYS = Object.freeze({ POD_ROOT: POD_ROOT_KEY });

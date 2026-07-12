/**
 * ExpoSecureStore — concrete {@link SecureStore} over `expo-secure-store`.
 *
 * The native module is lazy-required (or injected for tests), so importing
 * this file has no native side effect — apps that don't use secure storage
 * don't pay for it, and non-RN test environments can inject a fake.
 *
 * Behaviour is a 1:1 forward to `expo-secure-store`
 * (`getItemAsync`/`setItemAsync`/`deleteItemAsync`), so migrating
 * `new OidcSessionRN({ store: SecureStore })` →
 * `new OidcSessionRN({ store: new ExpoSecureStore().asOidcStore() })` is
 * behaviour-preserving.
 */
import { SecureStore } from '../SecureStore.js';

/* eslint-disable global-require */
function loadExpoSecureStore(injected) {
  if (injected) return injected;
  return require('expo-secure-store');
}
/* eslint-enable global-require */

export class ExpoSecureStore extends SecureStore {
  #store;

  /**
   * @param {object} [args]
   * @param {object} [args.store]  inject an `expo-secure-store`-shaped module
   *                               (`getItemAsync`/`setItemAsync`/`deleteItemAsync`)
   *                               for tests; defaults to `require('expo-secure-store')`.
   */
  constructor({ store } = {}) {
    super();
    this.#store = loadExpoSecureStore(store);
  }

  async get(key) {
    return this.#store.getItemAsync(key);
  }

  async set(key, value) {
    return this.#store.setItemAsync(key, value);
  }

  async delete(key) {
    return this.#store.deleteItemAsync(key);
  }
}

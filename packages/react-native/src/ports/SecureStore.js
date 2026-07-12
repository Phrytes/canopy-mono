/**
 * SecureStore — port for encrypted key/value device storage.
 * @abstract
 *
 * Consolidates the secure-storage idiom behind one named boundary.  The v1
 * concrete ({@link ExpoSecureStore}) wraps `expo-secure-store`; a future
 * platform could back it with the iOS Keychain / Android Keystore directly.
 *
 * Contract (all async):
 *   - `get(key)`    → the stored string, or `null` if absent.
 *   - `set(key, value)` → persist.
 *   - `delete(key)` → remove (idempotent).
 *
 * ── OIDC compatibility ──────────────────────────────────────────────────────
 * `OidcSessionRN` consumes an `expo-secure-store`-shaped store
 * (`getItemAsync`/`setItemAsync`/`deleteItemAsync`).  `asOidcStore()` adapts
 * this port to that shape with byte-identical behaviour, so the shells can
 * construct the session from the port instead of a raw `expo-secure-store`
 * import.
 */
export class SecureStore {
  /**
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async get(key) {
    throw new Error('SecureStore.get() not implemented');
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async set(key, value) {
    throw new Error('SecureStore.set() not implemented');
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async delete(key) {
    throw new Error('SecureStore.delete() not implemented');
  }

  /**
   * Adapt this port to the `expo-secure-store`-shaped store that
   * `OidcSessionRN` expects (`getItemAsync`/`setItemAsync`/`deleteItemAsync`).
   * @returns {{
   *   getItemAsync: (key: string) => Promise<string|null>,
   *   setItemAsync: (key: string, value: string) => Promise<void>,
   *   deleteItemAsync: (key: string) => Promise<void>,
   * }}
   */
  asOidcStore() {
    return {
      getItemAsync:    (key) => this.get(key),
      setItemAsync:    (key, value) => this.set(key, value),
      deleteItemAsync: (key) => this.delete(key),
    };
  }
}

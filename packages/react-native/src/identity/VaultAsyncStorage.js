/**
 * VaultAsyncStorage — Vault backed by @react-native-async-storage/async-storage.
 *
 * Hermes / RN equivalent of `VaultLocalStorage` from @onderling/vault.
 * Use this when you want plain-text persistence keyed by a prefix
 * (e.g. basis-mobile's chat-side identity / mute-list / audit
 * log).  For higher security wrap with an encryption layer or pick
 * KeychainVault (iOS Secure Enclave / Android Keystore) for the
 * identity seed specifically.
 *
 * Peer dependency: `@react-native-async-storage/async-storage`.
 *
 * Test injection: pass `opts.asyncStorage` to swap in a mock that
 * implements `getItem / setItem / removeItem / getAllKeys`.  All
 * vitest tests for this class use the mock — no real RN runtime
 * needed.
 *
 * Surface (mirrors VaultLocalStorage / VaultMemory exactly):
 *
 *   - get(key)         → Promise<string|null>
 *   - set(key, value)  → Promise<void>
 *   - delete(key)      → Promise<void>
 *   - has(key)         → Promise<boolean>
 *   - list()           → Promise<string[]>  (un-prefixed)
 *
 * Async-only Vault.has uses an extra fetch (AsyncStorage exposes no
 * "exists" primitive); VaultLocalStorage's `getItem !== null` check
 * is the same pattern.
 *
 * Task (2026-05-24) — part of basis-mobile's Hermes
 * storage path.  See Project Files/basis/mobile-roadmap-2026-05-24.md.
 */
import { Vault } from '@onderling/vault';

export class VaultAsyncStorage extends Vault {
  #prefix;
  #storage;

  /**
   * @param {object}  [opts]
   * @param {string}  [opts.prefix='dwag:']  — key namespace
   * @param {object}  [opts.asyncStorage]    — injectable mock for tests;
   *                                           defaults to the platform's
   *                                           @react-native-async-storage/async-storage
   */
  constructor({ prefix = 'dwag:', asyncStorage } = {}) {
    super();
    this.#prefix = prefix;
    if (asyncStorage) {
      this.#storage = asyncStorage;
    } else {
      // Lazy require so vitest can import this module without an
      // AsyncStorage polyfill — the constructor is only called when
      // an asyncStorage instance is actually needed.  Same pattern as
      // KeychainVault's `import * as keychain`.
      //
      // eslint-disable-next-line global-require
      this.#storage = require('@react-native-async-storage/async-storage').default;
    }
    if (!this.#storage || typeof this.#storage.getItem !== 'function') {
      throw new Error('VaultAsyncStorage requires @react-native-async-storage/async-storage (or an injected mock)');
    }
  }

  async get(key) {
    return this.#storage.getItem(this.#prefix + key);
  }

  async set(key, value) {
    await this.#storage.setItem(this.#prefix + key, String(value));
  }

  async delete(key) {
    await this.#storage.removeItem(this.#prefix + key);
  }

  async has(key) {
    const v = await this.#storage.getItem(this.#prefix + key);
    return v !== null && v !== undefined;
  }

  async list() {
    const all = await this.#storage.getAllKeys();
    return (all ?? [])
      .filter((k) => k.startsWith(this.#prefix))
      .map((k) => k.slice(this.#prefix.length));
  }
}

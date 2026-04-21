/**
 * AsyncStorageAdapter — StorageBackend for AgentCache / PeerGraph on React Native.
 *
 * Drop-in replacement for the localStorage/IndexedDB backends used in browsers.
 * Wraps @react-native-async-storage/async-storage.
 *
 * Peer dependency: @react-native-async-storage/async-storage
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export class AsyncStorageAdapter {
  #prefix;

  /**
   * @param {object} [opts]
   * @param {string} [opts.prefix='dwag:']  — key namespace
   */
  constructor({ prefix = 'dwag:' } = {}) {
    this.#prefix = prefix;
  }

  async get(key) {
    return AsyncStorage.getItem(`${this.#prefix}${key}`);
  }

  async set(key, value) {
    await AsyncStorage.setItem(`${this.#prefix}${key}`, value);
  }

  async delete(key) {
    await AsyncStorage.removeItem(`${this.#prefix}${key}`);
  }

  async keys() {
    const all = await AsyncStorage.getAllKeys();
    return all
      .filter(k => k.startsWith(this.#prefix))
      .map(k => k.slice(this.#prefix.length));
  }

  // PeerGraph storageBackend interface expects list() — alias of keys()
  async list() {
    return this.keys();
  }
}

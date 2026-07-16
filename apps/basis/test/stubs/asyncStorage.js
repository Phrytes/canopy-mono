/**
 * In-memory @react-native-async-storage/async-storage stub for vitest-node.
 *
 * The web-smoke test boots the full bundle, which transitively reaches this
 * RN-only leaf (pod-client dynamic-imports it). vite can't resolve the real RN
 * package in node, so we alias the specifier to this Map-backed stub. Default
 * export mirrors the AsyncStorage static API the SDK uses.
 */
const store = new Map();

const AsyncStorage = {
  getItem:     async (k) => (store.has(k) ? store.get(k) : null),
  setItem:     async (k, v) => { store.set(k, v); },
  removeItem:  async (k) => { store.delete(k); },
  getAllKeys:  async () => [...store.keys()],
  multiGet:    async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
  multiSet:    async (pairs) => { for (const [k, v] of pairs) store.set(k, v); },
  multiRemove: async (keys) => { for (const k of keys) store.delete(k); },
  clear:       async () => { store.clear(); },
};

export default AsyncStorage;

/**
 * In-memory @react-native-async-storage/async-storage stub for vitest-node.
 *
 * basis-mobile's portable boot tests transitively reach this RN-only leaf
 * (pod-client dynamic-imports it). vite mis-resolves the real package's RN entry
 * in node, so we alias the specifier to this Map-backed stub (resolve.alias hooks
 * vitest's resolver even for the dynamic import). Default export mirrors the
 * AsyncStorage static API the SDK uses.
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

/**
 * canopy-chat-mobile v2 — AsyncStorage-backed circle stores (M3).
 *
 * The shared circle stores (`@canopy-app/canopy-chat`) take an injectable
 * `{ load, save }` IO; web wires localStorage, mobile wires AsyncStorage
 * here.  Keys match the web convention verbatim (`cc.circlePolicy.<id>`,
 * `cc.circleOverride.<id>`, `cc.availability`) so a future pod-sync sees
 * the same shape on both surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import), so
 * vitest exercises the round-trip with a mock and the RN screens pass the
 * real AsyncStorage instance.
 */
import {
  createCirclePolicyStore,
  createMemberOverrideStore,
  createAvailabilityStore,
} from '@canopy-app/canopy-chat';

/** Per-id AsyncStorage IO: key = `${prefix}${id}`. */
export function asyncKeyedIo(prefix, storage) {
  return {
    load: async (id) => {
      try { const s = await storage.getItem(`${prefix}${id}`); return s ? JSON.parse(s) : null; }
      catch { return null; }
    },
    save: async (id, value) => {
      try { await storage.setItem(`${prefix}${id}`, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}

/** Single-key AsyncStorage IO (keyless store, e.g. cross-circle availability). */
export function asyncFixedIo(key, storage) {
  return {
    load: async () => {
      try { const s = await storage.getItem(key); return s ? JSON.parse(s) : null; }
      catch { return null; }
    },
    save: async (value) => {
      try { await storage.setItem(key, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}

export function makeCirclePolicyStoreRN(storage) {
  return createCirclePolicyStore(asyncKeyedIo('cc.circlePolicy.', storage));
}

export function makeMemberOverrideStoreRN(storage) {
  return createMemberOverrideStore(asyncKeyedIo('cc.circleOverride.', storage));
}

export function makeAvailabilityStoreRN(storage) {
  return createAvailabilityStore(asyncFixedIo('cc.availability', storage));
}

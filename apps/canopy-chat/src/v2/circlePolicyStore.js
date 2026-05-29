/**
 * canopy-chat v2 — circle policy persistence (shared, F2).
 *
 * Injectable `load`/`save` so the host wires the backend: web uses
 * localStorage today; pod `shared.json` (cross-app-settings convention)
 * swaps in later without touching callers. Normalises on read, deep-
 * merges edits onto the current value before saving.
 */
import {
  normalizeCirclePolicy, mergeCirclePolicy,
  normalizeMemberOverride, mergeMemberOverride,
} from './circlePolicy.js';

export function createCirclePolicyStore({ load, save } = {}) {
  return {
    async get(circleId) {
      let raw = null;
      try { raw = load ? await load(circleId) : null; } catch { raw = null; }
      return normalizeCirclePolicy(raw);
    },
    async update(circleId, patch) {
      const current = await this.get(circleId);
      const next = mergeCirclePolicy(current, patch);
      if (save) await save(circleId, next);
      return next;
    },
  };
}

/** localStorage-backed load/save (web). Key: `cc.circlePolicy.<circleId>`. */
export function localStoragePolicyIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circlePolicy.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, policy) => {
      try { storage?.setItem(key(id), JSON.stringify(policy)); } catch { /* ignore */ }
    },
  };
}

/**
 * The calling member's personal override for a circle (board 6A). Same
 * injectable shape as the policy store; keyed by circleId since the store
 * holds the local user's own override. (Cross-member overrides live in
 * each member's space; this is the local-user slice.)
 */
export function createMemberOverrideStore({ load, save } = {}) {
  return {
    async get(circleId) {
      let raw = null;
      try { raw = load ? await load(circleId) : null; } catch { raw = null; }
      return normalizeMemberOverride(raw);
    },
    async update(circleId, patch) {
      const current = await this.get(circleId);
      const next = mergeMemberOverride(current, patch);
      if (save) await save(circleId, next);
      return next;
    },
  };
}

/** localStorage-backed load/save for member overrides. Key: `cc.circleOverride.<circleId>`. */
export function localStorageOverrideIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circleOverride.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, override) => {
      try { storage?.setItem(key(id), JSON.stringify(override)); } catch { /* ignore */ }
    },
  };
}

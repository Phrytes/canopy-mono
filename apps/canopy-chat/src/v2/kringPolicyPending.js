/**
 * canopy-chat v2 — per-kring pending-policy cache (γ-next.policy).
 *
 * Tiny store that stashes ONE pending incoming policy doc per circle.
 * The policy receiver writes here on every valid broadcast; the
 * settings editor reads on mount and passes the cached policy via
 * γ.4's `incomingPolicy` opt.  After the resolver applies or discards
 * the incoming, the editor clears the slot.
 *
 * Storage is injected (`load`/`save`/`remove`) so web wires localStorage
 * and mobile wires AsyncStorage via thin adapters (see
 * `kringPolicyPendingStorage.js` + `kringPolicyPendingStorageRN.js`).
 *
 * Multi-broadcast policy — last-write-wins.  If two broadcasts arrive
 * while the editor is closed, the second overwrites the first; the
 * γ.4 resolver still runs the per-field 3-way merge against the
 * versions history, so divergence is detected even when the slot held
 * an older payload.
 */

/**
 * Build a per-kring pending-policy store from injected IO.
 *
 * @param {object} [io]
 * @param {(circleId: string) => Promise<object|null>} [io.load]    read the
 *        cached policy for `circleId`; null when no broadcast pending.
 * @param {(circleId: string, policy: object) => Promise<void>} [io.save]
 *        write the cached policy.
 * @param {(circleId: string) => Promise<void>} [io.remove]         clear
 *        the slot (called by the editor after applied / discarded).
 * @returns {{ get: Function, set: Function, clear: Function }}
 */
export function createKringPolicyPendingStore({ load, save, remove } = {}) {
  return {
    async get(circleId) {
      if (typeof circleId !== 'string' || !circleId) return null;
      if (typeof load !== 'function') return null;
      try { return (await load(circleId)) ?? null; }
      catch { return null; }
    },
    async set(circleId, policy) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof save !== 'function') return;
      try { await save(circleId, policy); } catch { /* ignore */ }
    },
    async clear(circleId) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof remove !== 'function') return;
      try { await remove(circleId); } catch { /* ignore */ }
    },
  };
}

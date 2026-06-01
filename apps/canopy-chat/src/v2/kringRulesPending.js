/**
 * canopy-chat v2 — per-kring pending-rules cache (γ-next.rules).
 *
 * Tiny store that stashes ONE pending incoming rules doc per circle.
 * The rules receiver writes here on every valid broadcast; the rules
 * editor reads on mount and passes the cached rules via γ.4's
 * `incomingRules` opt.  After the resolver applies or discards the
 * incoming, the editor clears the slot.
 *
 * Storage is injected (`load`/`save`/`remove`) so web wires localStorage
 * and mobile wires AsyncStorage via thin adapters (see
 * `kringRulesPendingStorage.js` + `kringRulesPendingStorageRN.js`).
 *
 * Multi-broadcast policy — last-write-wins.  If two broadcasts arrive
 * while the editor is closed, the second overwrites the first; the
 * γ.4 resolver still runs the per-field 3-way merge against the
 * versions history, so divergence is detected even when the slot held
 * an older payload.
 */

/**
 * Build a per-kring pending-rules store from injected IO.
 *
 * @param {object} [io]
 * @param {(circleId: string) => Promise<object|null>} [io.load]    read the
 *        cached rules for `circleId`; null when no broadcast pending.
 * @param {(circleId: string, rulesDoc: object) => Promise<void>} [io.save]
 *        write the cached rules.
 * @param {(circleId: string) => Promise<void>} [io.remove]         clear
 *        the slot (called by the editor after applied / discarded).
 * @returns {{ get: Function, set: Function, clear: Function }}
 */
export function createKringRulesPendingStore({ load, save, remove } = {}) {
  return {
    async get(circleId) {
      if (typeof circleId !== 'string' || !circleId) return null;
      if (typeof load !== 'function') return null;
      try { return (await load(circleId)) ?? null; }
      catch { return null; }
    },
    async set(circleId, rulesDoc) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof save !== 'function') return;
      try { await save(circleId, rulesDoc); } catch { /* ignore */ }
    },
    async clear(circleId) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof remove !== 'function') return;
      try { await remove(circleId); } catch { /* ignore */ }
    },
  };
}

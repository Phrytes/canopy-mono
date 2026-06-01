/**
 * canopy-chat v2 — per-kring pending-recipe cache (γ-next.recipe).
 *
 * Tiny store that stashes ONE pending incoming recipe per circle.  The
 * recipe receiver writes here on every valid broadcast; the recipe
 * editor reads on mount and passes the cached recipe via γ.3's
 * `incomingRecipe` opt.  After the resolver applies or discards the
 * incoming, the editor clears the slot.
 *
 * Storage is injected (`load`/`save`/`remove`) so web wires localStorage
 * and mobile wires AsyncStorage via thin adapters (see
 * `kringRecipePendingStorage.js` + `kringRecipePendingStorageRN.js`).
 *
 * Multi-broadcast policy — last-write-wins.  If two broadcasts arrive
 * while the editor is closed, the second overwrites the first; the
 * γ.3 resolver still runs the per-block 3-way merge against the
 * versions history, so divergence is detected even when the slot held
 * an older payload.
 */

/**
 * Build a per-kring pending-recipe store from injected IO.
 *
 * @param {object} [io]
 * @param {(circleId: string) => Promise<object|null>} [io.load]    read the
 *        cached recipe for `circleId`; null when no broadcast pending.
 * @param {(circleId: string, recipe: object) => Promise<void>} [io.save]
 *        write the cached recipe.
 * @param {(circleId: string) => Promise<void>} [io.remove]         clear
 *        the slot (called by the editor after applied / discarded).
 * @returns {{ get: Function, set: Function, clear: Function }}
 */
export function createKringRecipePendingStore({ load, save, remove } = {}) {
  return {
    async get(circleId) {
      if (typeof circleId !== 'string' || !circleId) return null;
      if (typeof load !== 'function') return null;
      try { return (await load(circleId)) ?? null; }
      catch { return null; }
    },
    async set(circleId, recipe) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof save !== 'function') return;
      try { await save(circleId, recipe); } catch { /* ignore */ }
    },
    async clear(circleId) {
      if (typeof circleId !== 'string' || !circleId) return;
      if (typeof remove !== 'function') return;
      try { await remove(circleId); } catch { /* ignore */ }
    },
  };
}

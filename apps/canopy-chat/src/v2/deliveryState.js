/**
 * canopy-chat v2 — per-message delivery state (δ.2).
 *
 * The kring chat send is optimistic: the local user's message is
 * appended to the in-memory EventLog the moment the composer fires,
 * then a best-effort `broadcastKringMessage` fan-out runs in the
 * background.  Before δ.2, failures were silent — the user never
 * knew if their message reached peers.
 *
 * δ.2 keeps a SIBLING map (keyed by `msgId`) of one of:
 *   - `'pending'`  — fan-out in flight; bubble shows a clock icon
 *   - `'sent'`     — fan-out resolved with no errors; bubble shows nothing (happy-path stays clean)
 *   - `'failed'`   — fan-out rejected or returned `errors[]`; bubble shows a warning that taps to retry
 *
 * The EventLog stays append-only.  This map is a separate piece of
 * UI state read at render time and re-fired when state flips.
 *
 * Subscribers receive `(msgId, state)` where `state` is the new value
 * (or `null` when the entry was cleared).
 *
 * Platform: neutral (plain JS).  Used by both web (circleApp.js) and
 * mobile (CircleLauncherScreen.js) kring chat send paths.
 */

/**
 * @typedef {'pending' | 'sent' | 'failed' | null} DeliveryState
 */

/**
 * @typedef {object} DeliveryStateMap
 * @property {(msgId: string) => DeliveryState} get
 *   Returns the current state for `msgId`, or `null` if not tracked.
 * @property {(msgId: string, state: DeliveryState) => void} set
 *   Sets the state for `msgId`.  Pass `null` (or `undefined`) to
 *   clear the entry — useful so the map doesn't grow unbounded as
 *   sent messages accumulate.  Notifies subscribers either way.
 * @property {(msgId: string) => boolean} clear
 *   Convenience: equivalent to `set(msgId, null)`.  Returns `true`
 *   if an entry was actually removed.
 * @property {() => number} size
 *   Number of tracked entries (post-clear).
 * @property {(fn: (msgId: string, state: DeliveryState) => void) => () => void} subscribe
 *   Register a listener.  Returns an unsubscribe handle.
 */

/**
 * Factory.  One map per agent boot — instantiated alongside the
 * EventLog so its lifetime matches the in-memory event stream.
 *
 * @returns {DeliveryStateMap}
 */
export function createDeliveryStateMap() {
  /** @type {Map<string, Exclude<DeliveryState, null>>} */
  const map = new Map();
  /** @type {Set<(msgId: string, state: DeliveryState) => void>} */
  const subs = new Set();

  function notify(msgId, state) {
    for (const fn of subs) {
      try { fn(msgId, state); } catch { /* swallow */ }
    }
  }

  return {
    get(msgId) {
      if (typeof msgId !== 'string' || msgId === '') return null;
      return map.has(msgId) ? map.get(msgId) : null;
    },
    set(msgId, state) {
      if (typeof msgId !== 'string' || msgId === '') return;
      if (state == null) {
        if (!map.has(msgId)) return;
        map.delete(msgId);
        notify(msgId, null);
        return;
      }
      if (state !== 'pending' && state !== 'sent' && state !== 'failed') return;
      map.set(msgId, state);
      notify(msgId, state);
    },
    clear(msgId) {
      if (typeof msgId !== 'string' || msgId === '') return false;
      if (!map.has(msgId)) return false;
      map.delete(msgId);
      notify(msgId, null);
      return true;
    },
    size() { return map.size; },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

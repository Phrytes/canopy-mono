/**
 * catchUpWiring — stoop-mobile reconnect-catch-up scaffold (#247).
 *
 * Status: PARTIAL.  Ships the implementable half today:
 *   - lastSeenFrom persistence (per-peer high-water-mark map) backed
 *     by AsyncStorage so a fresh boot remembers what we already saw.
 *   - wireCatchUp() entry point that the agent bundle invokes after
 *     the per-group ItemStore is online.
 *
 * What it does NOT do yet (filed as #247.1):
 *   The lifted handler factory at
 *   `apps/canopy-chat/src/core/handlers/catchUp.js` (#221.5) was
 *   built for canopy-chat web's NKN-direct point-to-point envelopes:
 *
 *       sendPeer(addr, {type:'p2p-chat', subtype:'catch-up-request', …})
 *
 *   Stoop-mobile's transport stack is mDNS + BLE + RelayTransport.
 *   None of these handle the `subtype`-routed envelope shape natively;
 *   they expose `agent.invoke(peerAddress, skillId, parts)` instead.
 *   Three design options to wire the catch-up flow end-to-end (an
 *   architectural decision the orchestrator deferred until the
 *   mismatch was clear):
 *
 *     A. **Add NknTransport to stoop-mobile.**  The lifted handler
 *        drops in unchanged.  ~1.5d ship; gives stoop-mobile every
 *        canopy-chat-mobile mesh story for free.  Best long-term
 *        architectural alignment.
 *
 *     B. **Translate to stoop-mobile envelopes.**  Wrap sendPeer to
 *        emit a stoop-substrate envelope the receiver's existing
 *        item-arrive bridge picks up.  ~half-day; smaller blast
 *        radius but introduces a parallel catch-up codepath.
 *
 *     C. **Implement a stoop-mobile-native catch-up.**  Use the
 *        notify-envelope substrate (the existing per-recipient fan-
 *        out) to broadcast "I came online; serve me posts since X"
 *        intents.  ~1d; matches stoop-mobile's substrate idioms
 *        but diverges from canopy-chat's reusable factory.
 *
 *   The lastSeenFrom persistence below is identical for all three
 *   options + is already useful for diagnostics.
 *
 * Task #247 (2026-05-24).  See Project Files/canopy-chat/
 * mobile-roadmap-2026-05-24.md.
 */

const ASYNC_STORAGE_KEY = 'stoop:catch-up:lastSeenFrom';

/**
 * Persisted per-peer high-water mark map: peerAddr → ms timestamp.
 *
 * Used by every catch-up wiring option (A/B/C above) — the "since
 * when" filter for the receiver's listBuurtPostsSince query lives
 * here.  Pure JS; injectable AsyncStorage so vitest can exercise it.
 */
export class LastSeenFromStore {
  #storage;
  #key;
  #cache = null;   // null until first load

  /**
   * @param {object} args
   * @param {object} args.asyncStorage    @react-native-async-storage/async-storage instance OR mock
   * @param {string} [args.key='stoop:catch-up:lastSeenFrom']  override key namespace
   */
  constructor({ asyncStorage, key = ASYNC_STORAGE_KEY } = {}) {
    if (!asyncStorage || typeof asyncStorage.getItem !== 'function') {
      throw new Error('LastSeenFromStore: requires asyncStorage with getItem/setItem/removeItem');
    }
    this.#storage = asyncStorage;
    this.#key     = key;
  }

  async _load() {
    if (this.#cache) return this.#cache;
    let raw;
    try {
      raw = await this.#storage.getItem(this.#key);
    } catch {
      raw = null;
    }
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      this.#cache = (parsed && typeof parsed === 'object') ? parsed : {};
    } catch {
      this.#cache = {};
    }
    return this.#cache;
  }

  /** Get the high-water timestamp for `peerAddr` (0 = never seen). */
  async get(peerAddr) {
    const all = await this._load();
    const v   = all[peerAddr];
    return typeof v === 'number' ? v : 0;
  }

  /** Set `peerAddr → ms`; persists immediately (debounce is caller's choice). */
  async set(peerAddr, ms) {
    const all = await this._load();
    if (all[peerAddr] === ms) return;
    all[peerAddr] = ms;
    await this.#storage.setItem(this.#key, JSON.stringify(all));
  }

  /**
   * Bump `peerAddr` to MAX(current, ms) — the natural high-water-
   * mark update (newer wins).  Use this on every item-arrive to
   * keep the next catch-up's `sinceMs` tight.
   */
  async bump(peerAddr, ms) {
    const cur = await this.get(peerAddr);
    if (ms > cur) await this.set(peerAddr, ms);
  }

  /** Read all peer→ms entries (returns a shallow clone). */
  async entries() {
    const all = await this._load();
    return { ...all };
  }

  /** Forget a peer (e.g. they rotated identity).  Returns true if it existed. */
  async forget(peerAddr) {
    const all = await this._load();
    if (!(peerAddr in all)) return false;
    delete all[peerAddr];
    await this.#storage.setItem(this.#key, JSON.stringify(all));
    return true;
  }

  /** Test-only: drop the cache so the next read re-fetches from storage. */
  _invalidate() { this.#cache = null; }
}

/**
 * Wire the reconnect-catch-up flow into a stoop-mobile agent bundle.
 *
 * @param {object} args
 * @param {object} args.bundle              agent bundle (must expose .agent + .itemStore)
 * @param {object} args.asyncStorage        for the LastSeenFromStore
 * @param {{info?, warn?, error?}} [args.logger]
 * @returns {{ lastSeenFrom: LastSeenFromStore, dispose: () => void, scheduleCatchUp: () => Promise<void> }}
 */
export function wireCatchUp({ bundle, asyncStorage, logger = console } = {}) {
  if (!bundle) throw new Error('wireCatchUp: bundle required');
  const lastSeenFrom = new LastSeenFromStore({ asyncStorage });

  // Always-on: keep lastSeenFrom up to date as items arrive.  This
  // half works regardless of which architectural option (A/B/C)
  // ships, so we wire it now.
  const onItemArrive = (item) => {
    const addr = item?.source?.fromAddr ?? item?.source?.fromPubKey;
    const ms   = item?.addedAt ?? item?._addedAt ?? Date.now();
    if (addr && typeof ms === 'number') {
      lastSeenFrom.bump(addr, ms).catch((err) => {
        logger.warn?.('[catch-up] bump failed', err);
      });
    }
  };
  bundle.agent?.on?.('item-arrive', onItemArrive);

  // The actual catch-up REQUEST trigger is parked — needs the
  // architectural decision from the module-doc above.  Today's
  // call is a logged no-op; #247.1 implements the real send.
  const scheduleCatchUp = async () => {
    logger.info?.('[catch-up] scheduleCatchUp called — see #247.1 for the impl path');
  };

  const dispose = () => {
    bundle.agent?.off?.('item-arrive', onItemArrive);
  };

  return { lastSeenFrom, dispose, scheduleCatchUp };
}

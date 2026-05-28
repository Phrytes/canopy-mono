/**
 * catchUpWiring — stoop-mobile reconnect-catch-up (#247 → #248).
 *
 * Ships:
 *   - `LastSeenFromStore` — per-peer high-water-mark map backed by
 *     AsyncStorage.  Updated on every item-arrive so the next catch-up
 *     can ask "give me posts since <ms>" tightly.
 *   - `wireCatchUp()` — wires the item-arrive listener + returns a
 *     `scheduleCatchUp()` that fires the lifted
 *     `requestCatchUpFromKnownPeers` from canopy-chat-handlers, plus an
 *     inbound `catch-up-request` handler that replies via buurt-post.
 *
 * #248 (2026-05-27, Option A): "Add NknTransport to stoop-mobile."
 *   The lifted handler factories live in
 *   `apps/canopy-chat/src/core/handlers/catchUp.js` and operate on
 *   `{callSkill, sendPeer}`.  Stoop-mobile's bundle now exposes
 *   `bundle.nkn` (the NknTransport adapter, see agentBundle.js) and
 *   `bundle.agent.invoke` is bridged to a `callSkill(appOrigin, opId,
 *   args)` shim that ignores appOrigin (stoop-mobile's skill bus is
 *   registered once at boot, dispatch is on opId + args.groupId/_scope).
 *
 *   The catch-up trigger fires 1.5s after `bundle.nkn` emits 'connect'
 *   (matches canopy-chat-mobile's pattern in
 *    apps/canopy-chat-mobile/src/core/agentBundle.js).  If `bundle.nkn`
 *   is missing (no nknLib at boot — soft dep), `scheduleCatchUp` logs
 *   "no NKN transport" and resolves; everything else stays intact.
 *
 * Architectural constraint (canopy-chat-unifier-principle):
 *   the handlers live in apps/canopy-chat/src/core/handlers/; we
 *   import them via relative path (Metro doesn't honor exports
 *   subpaths).  Don't move them.
 */

import {
  makeRequestCatchUpFromKnownPeers,
  makeHandleCatchUpRequest,
} from '../../../canopy-chat/src/core/handlers/catchUp.js';
import { makeHandleBuurtPost } from '../../../canopy-chat/src/core/handlers/buurtPost.js';
import { makePeerRouter }      from '../../../canopy-chat/src/core/handlers/peerRouter.js';
import { toParts, unwrapParts } from '@canopy/sync-engine-rn/react';

const ASYNC_STORAGE_KEY = 'stoop:catch-up:lastSeenFrom';

/**
 * Bridge stoop-mobile's `agent.invoke(peer, opId, parts)` to the
 * `callSkill(appOrigin, opId, args)` shape the lifted handlers expect.
 *
 * The lifted handlers pass `appOrigin` (e.g. 'stoop') as the first
 * arg; we drop it — stoop-mobile registers every skill on a single
 * agent and dispatches by opId + args.groupId/_scope (see
 * ServiceContext.js getBundle).  The `_scope` arg is left unset so the
 * agent's group resolver picks up `args.groupId` (the handlers always
 * pass it).
 *
 * @param {object} args
 * @param {object} args.agent  stoop-mobile mesh agent
 */
export function makeStoopCallSkill({ agent }) {
  return async function callSkill(_appOrigin, opId, args) {
    const baseArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    const parts    = toParts(baseArgs);
    const localPeer = agent.address ?? agent.identity?.pubKey ?? null;
    if (!localPeer) {
      throw new Error('makeStoopCallSkill: agent has no address/identity.pubKey');
    }
    const raw = await agent.invoke(localPeer, opId, parts);
    return unwrapParts(raw);
  };
}

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
 * #248 (Option A): when `bundle.nkn` is present, also:
 *   - register the inbound `catch-up-request` handler (replies with
 *     buurt-post envelopes the receiver ingests via stoop.ingestRemotePost).
 *   - register the inbound `buurt-post` handler so catch-up REPLIES land
 *     cleanly via the same path canopy-chat-mobile uses.
 *   - fire `scheduleCatchUp` 1.5s after the NKN transport emits 'connect'.
 *
 * When `bundle.nkn` is missing (soft-dep skipped — no nknLib at boot),
 * the item-arrive bookkeeping still runs; `scheduleCatchUp` logs +
 * resolves so callers can call it without conditionals.
 *
 * @param {object} args
 * @param {object} args.bundle              agent bundle (must expose .agent; .nkn optional)
 * @param {object} args.asyncStorage        for the LastSeenFromStore
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} [args.callSkill]   override; defaults to a bridge over `bundle.agent.invoke`
 * @param {object} [args.publishEvent]      optional publishEvent forwarded to the buurt-post handler (for /logs)
 * @param {{info?, warn?, error?}} [args.logger]
 * @returns {{
 *   lastSeenFrom: LastSeenFromStore,
 *   dispose: () => void,
 *   scheduleCatchUp: () => Promise<void>,
 * }}
 */
export function wireCatchUp({
  bundle, asyncStorage, callSkill, publishEvent, logger = console,
} = {}) {
  if (!bundle) throw new Error('wireCatchUp: bundle required');
  const lastSeenFrom = new LastSeenFromStore({ asyncStorage });

  // Always-on: keep lastSeenFrom up to date as items arrive.
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

  // ── #248 catch-up trigger + inbound handlers ──────────────────────
  // Build callSkill once (either caller-supplied or the agent.invoke
  // bridge) so both the outbound request + the inbound reply share a
  // single dispatch path.
  let callSkillImpl = callSkill;
  if (typeof callSkillImpl !== 'function' && bundle.agent?.invoke) {
    callSkillImpl = makeStoopCallSkill({ agent: bundle.agent });
  }

  const nkn = bundle.nkn ?? null;

  // sendPeer = NknTransport.sendOneWay (via the adapter).  When nkn is
  // absent the outbound side fails-soft — scheduleCatchUp logs + bails.
  const sendPeer = nkn
    ? (addr, payload) => nkn.sendTo(addr, payload)
    : null;

  // Build the outbound trigger ONCE (cheap; no I/O until called).
  const requestCatchUp = (callSkillImpl && sendPeer)
    ? makeRequestCatchUpFromKnownPeers({ callSkill: callSkillImpl, sendPeer, logger })
    : null;

  // Inbound handlers — wired only when NKN is up + we have callSkill.
  let onConnect = null;
  let peerRouterCb = null;
  if (nkn && callSkillImpl) {
    const handlers = {
      'catch-up-request': makeHandleCatchUpRequest({
        callSkill: callSkillImpl,
        sendPeer,
        getMyPubKey: () => nkn.address ?? bundle.agent?.address ?? null,
        logger,
      }),
      'buurt-post': makeHandleBuurtPost({
        callSkill:   callSkillImpl,
        publishEvent: typeof publishEvent === 'function' ? publishEvent : undefined,
        logger,
      }),
    };
    peerRouterCb = makePeerRouter({ handlers, logger });
    nkn.on?.('peer-message', peerRouterCb);

    // 1.5s settle window after 'connect' (matches canopy-chat-mobile —
    // apps/canopy-chat-mobile/src/core/agentBundle.js).  Mirrors the
    // HI-handshake settle window the web peer uses.
    onConnect = () => {
      setTimeout(() => {
        scheduleCatchUp().catch((err) => {
          logger.warn?.('[catch-up] scheduled requestCatchUp failed', err?.message ?? err);
        });
      }, 1500);
    };
    nkn.on?.('connect', onConnect);
  }

  /**
   * Fire `requestCatchUpFromKnownPeers`.  Caller can also invoke this
   * directly (e.g. from a UI "Refresh" affordance) — the 1.5s post-
   * connect fire is wired automatically.
   */
  const scheduleCatchUp = async () => {
    if (!requestCatchUp) {
      logger.info?.('[catch-up] scheduleCatchUp: no NKN transport — skip');
      return;
    }
    logger.info?.('[catch-up] scheduleCatchUp firing requestCatchUpFromKnownPeers');
    await requestCatchUp();
  };

  const dispose = () => {
    bundle.agent?.off?.('item-arrive', onItemArrive);
    if (nkn && onConnect)     { try { nkn.off?.('connect', onConnect);             } catch { /* swallow */ } }
    if (nkn && peerRouterCb)  { try { nkn.off?.('peer-message', peerRouterCb);     } catch { /* swallow */ } }
  };

  return { lastSeenFrom, dispose, scheduleCatchUp };
}

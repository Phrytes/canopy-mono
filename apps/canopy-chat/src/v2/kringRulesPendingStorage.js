/**
 * canopy-chat v2 — localStorage IO for the pending-rules cache (γ-next.rules).
 *
 * Thin instantiation of the shared kring-kind pending storage
 * (`kringKindFactory.js`).  Wires `createKringRulesPendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.kringRulesPending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createKringKindPendingStore,
  makeKringKindPendingLocalIo,
} from './kringKindFactory.js';

const KEY_PREFIX = 'cc.kringRulesPending.';

export function localStorageKringRulesPendingIo(storage = globalThis.localStorage) {
  return makeKringKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createKringRulesPendingStoreLocal(storage = globalThis.localStorage) {
  return createKringKindPendingStore(localStorageKringRulesPendingIo(storage));
}

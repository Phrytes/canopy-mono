/**
 * canopy-chat v2 — localStorage IO for the pending-policy cache (γ-next.policy).
 *
 * Thin instantiation of the shared kring-kind pending storage
 * (`kringKindFactory.js`).  Wires `createKringPolicyPendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.kringPolicyPending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createKringKindPendingStore,
  makeKringKindPendingLocalIo,
} from './kringKindFactory.js';

const KEY_PREFIX = 'cc.kringPolicyPending.';

export function localStorageKringPolicyPendingIo(storage = globalThis.localStorage) {
  return makeKringKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createKringPolicyPendingStoreLocal(storage = globalThis.localStorage) {
  return createKringKindPendingStore(localStorageKringPolicyPendingIo(storage));
}

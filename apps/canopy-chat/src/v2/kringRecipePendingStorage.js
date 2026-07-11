/**
 * canopy-chat v2 — localStorage IO for the pending-recipe cache (γ-next.recipe).
 *
 * Thin instantiation of the shared kring-kind pending storage
 * (`kringKindFactory.js`).  Wires `createKringRecipePendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.kringRecipePending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createKringKindPendingStore,
  makeKringKindPendingLocalIo,
} from './kringKindFactory.js';

const KEY_PREFIX = 'cc.kringRecipePending.';

export function localStorageKringRecipePendingIo(storage = globalThis.localStorage) {
  return makeKringKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createKringRecipePendingStoreLocal(storage = globalThis.localStorage) {
  return createKringKindPendingStore(localStorageKringRecipePendingIo(storage));
}

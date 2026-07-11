/**
 * canopy-chat v2 — per-kring pending-policy cache (γ-next.policy).
 *
 * Thin re-export of the shared kring-kind pending store
 * (`kringKindFactory.js`).  Stashes ONE pending incoming policy doc per
 * circle; the policy receiver writes on every valid broadcast, the
 * settings editor reads on mount (via γ.4's `incomingPolicy` opt) and
 * clears the slot after apply/discard.  Storage IO is injected
 * (`load`/`save`/`remove`) — see `kringPolicyPendingStorage.js`.  Store
 * behaviour is identical across the policy/rules/recipe triplet (the doc
 * is treated opaquely), so it lives once in the factory.
 */

export { createKringKindPendingStore as createKringPolicyPendingStore } from './kringKindFactory.js';

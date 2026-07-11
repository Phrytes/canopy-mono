/**
 * canopy-chat v2 — kring policy-broadcast receiver substrate (γ-next.policy).
 *
 * Thin instantiation of the shared kring-kind receiver factory
 * (`kringKindFactory.js`).  Where the rules receiver caches the incoming
 * rules doc, the policy receiver caches the circlePolicy document; the
 * settings editor reads the cache on mount and passes it via γ.4's
 * conflict resolver (`incomingPolicy` opt).  Hosts register the handler
 * on the peer-router under subtype `'kring-policy-broadcast'`.
 *
 * Behaviour (envelope validation, msgId LRU dedup, last-write-wins cache)
 * is identical across the policy/rules/recipe triplet; only the descriptor
 * below differs.  circlePolicy is structured (nested `features:{...}`,
 * `push:{...}`, enum axes) but the receiver/cache treats it opaquely — the
 * field-by-field merge lives in `detectPolicyConflicts` / `applyPolicyResolution`.
 */

import { makeKringKindReceiver } from './kringKindFactory.js';

export const makeKringPolicyPeerHandler = makeKringKindReceiver({
  subtype:    'kring-policy-broadcast',
  payloadKey: 'policy',
  logTag:     '[kring-policy]',
});

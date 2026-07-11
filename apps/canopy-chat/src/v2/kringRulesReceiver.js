/**
 * canopy-chat v2 — kring rules-broadcast receiver substrate (γ-next.rules).
 *
 * Thin instantiation of the shared kring-kind receiver factory
 * (`kringKindFactory.js`).  Caches the incoming rules doc in a per-kring
 * "pending" cache; the rules editor reads on mount and passes it via γ.4's
 * conflict resolver (`incomingRules` opt).  Hosts register the handler on
 * the peer-router under subtype `'kring-rules-broadcast'`.
 *
 * Behaviour (envelope validation, msgId LRU dedup, last-write-wins cache)
 * is identical across the policy/rules/recipe triplet; only the descriptor
 * below differs.
 */

import { makeKringKindReceiver } from './kringKindFactory.js';

export const makeKringRulesPeerHandler = makeKringKindReceiver({
  subtype:    'kring-rules-broadcast',
  payloadKey: 'rulesDoc',
  logTag:     '[kring-rules]',
});

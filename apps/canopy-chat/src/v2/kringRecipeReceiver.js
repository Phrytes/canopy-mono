/**
 * canopy-chat v2 — kring recipe-broadcast receiver substrate (γ-next.recipe).
 *
 * Thin instantiation of the shared kring-kind receiver factory
 * (`kringKindFactory.js`).  Caches the incoming recipe in a per-kring
 * "pending" cache; the recipe editor reads on mount and passes it to γ.3's
 * conflict resolver (`incomingRecipe` opt).  Hosts register the handler on
 * the peer-router under subtype `'kring-recipe-broadcast'`.
 *
 * Behaviour (envelope validation, msgId LRU dedup, last-write-wins cache)
 * is identical across the policy/rules/recipe triplet; only the descriptor
 * below differs.
 */

import { makeKringKindReceiver } from './kringKindFactory.js';

export const makeKringRecipePeerHandler = makeKringKindReceiver({
  subtype:    'kring-recipe-broadcast',
  payloadKey: 'recipe',
  logTag:     '[kring-recipe]',
});

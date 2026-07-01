/**
 * skills/addItem — append a new item to a household LIST.
 *
 * args  : { type: ItemType, text: string }
 * ctx   : SkillContext (carries store, chatId, senderWebid, …)
 * reply : "✓ added to <type>: <text>" + an `item.added` stateUpdate.
 *
 * B · Layer 1 — this is the `add` atom resolved for the four LIST nouns
 * (shopping/errand/repair/schedule).  The store-write + `item.added`
 * emission live in the single shared `createHouseholdItem` create path
 * (which `addTask` also uses for the `task` noun); this handler only adds
 * the list-noun type guard.  Behaviour is byte-identical to the pre-
 * consolidation handler.
 *
 * Pure: no platform-specific imports.  The agent is responsible for
 * routing the returned Reply back to the bridge that originated the
 * incoming message.
 */

import { createHouseholdItem } from './createHouseholdItem.js';

const KNOWN_TYPES = new Set(['shopping', 'errand', 'repair', 'schedule']);

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function addItem(args, ctx) {
  const { type, text } = args ?? {};

  if (!type || !KNOWN_TYPES.has(type)) {
    return {
      replies: [
        {
          text:
            `Couldn't add — unknown type "${type ?? ''}". ` +
            `Known: shopping, errand, repair, schedule.`,
        },
      ],
      stateUpdates: [],
    };
  }

  return createHouseholdItem(type, { text }, ctx);
}

/**
 * skills/addItem — append a new item to the store.
 *
 * args  : { type: ItemType, text: string }
 * ctx   : SkillContext (carries store, chatId, senderWebid, …)
 * reply : "✓ added to <type>: <text>" + an `item.added` stateUpdate.
 *
 * Pure: no platform-specific imports.  The agent is responsible for
 * routing the returned Reply back to the bridge that originated the
 * incoming message.
 */

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

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      replies: [{ text: `Couldn't add — text is empty.` }],
      stateUpdates: [],
    };
  }

  // TODO: messageId is not available in SkillContext — the agent
  // strips that detail before invoking skills.  Use '?' as a
  // placeholder; the agent will fill it in once it lands (see
  // implementation-plan.md "convergence" section).
  const item = await ctx.store.addItem({
    type,
    text: text.trim(),
    addedBy: ctx.senderWebid,
    source: { tg: { chatId: ctx.chatId, messageId: '?' } },
  });

  return {
    replies: [{ text: `✓ added to ${item.type}: ${item.text}` }],
    stateUpdates: [
      { kind: 'item.added', itemId: item.id, chatId: ctx.chatId },
    ],
  };
}

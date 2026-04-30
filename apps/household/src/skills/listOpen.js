/**
 * skills/listOpen — list open items of a type.
 *
 * args : { type?: ItemType, since?: number }   // both optional
 * ctx  : SkillContext
 * reply: numbered list, with one `[mark done — <id-prefix>]` button per
 *        item if the list is small (≤10).  Empty list is a friendly
 *        "Nothing open in <type>." message.
 *
 * Emits no stateUpdates.
 */

const ID_PREFIX_LEN = 8;
const BUTTON_THRESHOLD = 10;
const KNOWN_TYPES = new Set(['shopping', 'errand', 'repair', 'schedule']);

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function listOpen(args, ctx) {
  const { type, since } = args ?? {};

  if (type !== undefined && !KNOWN_TYPES.has(type)) {
    return {
      replies: [
        {
          text:
            `Couldn't list — unknown type "${type}". ` +
            `Known: shopping, errand, repair, schedule.`,
        },
      ],
      stateUpdates: [],
    };
  }

  const items = await ctx.store.listOpen({ type, since });

  if (items.length === 0) {
    const label = type ?? 'any list';
    return {
      replies: [{ text: `Nothing open in ${label}.` }],
      stateUpdates: [],
    };
  }

  const header = type ? `${type}:` : 'open items:';
  const lines = items.map((it, idx) => `${idx + 1}. ${it.text}`);
  const text = `${header}\n${lines.join('\n')}`;

  /** @type {import('../types.js').ReplyMessage} */
  const message = { text };

  if (items.length <= BUTTON_THRESHOLD) {
    message.buttons = items.map((it) => ({
      id: it.id,
      label: `mark done — ${it.id.slice(0, ID_PREFIX_LEN)}`,
    }));
  }

  return { replies: [message], stateUpdates: [] };
}

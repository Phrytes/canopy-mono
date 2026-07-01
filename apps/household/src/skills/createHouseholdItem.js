/**
 * skills/createHouseholdItem — the SINGLE shared CREATE path (B · Layer 1).
 *
 * The `add` atom is ONE verb resolved per noun: `addItem` (list nouns —
 * shopping/errand/repair/schedule) and `addTask` (the `task` noun) are both
 * noun-specific spellings of *create a typed thing*.  This function is that
 * one create path; the two op handlers are thin, noun-specific front-ends.
 *
 * This is ADDITIVE CONSOLIDATION, not a rename: `addItem`/`addTask` keep their
 * ids, their args, and their byte-identical replies + stateUpdates.  The only
 * change is that the store-write + `item.added` emission live in one place.
 *
 * args   : (noun, { text, dueAt?, assignee? }, ctx, opts?)
 * ctx    : SkillContext (carries store, chatId, senderWebid, …)
 * opts   : { emptyText, reply } — per-noun copy (list vs task wording)
 * return : { replies, stateUpdates } (the renderChat Reply shape)
 *
 * Pure: no platform-specific imports.  Callers route the returned Reply back
 * to the originating bridge.
 */

/**
 * @param {string} noun  the canonical item type to create (e.g. 'shopping', 'task').
 * @param {{ text?: string, dueAt?: number, assignee?: string }} fields
 * @param {import('../types.js').SkillContext} ctx
 * @param {{ emptyText?: string, reply?: (item: any) => string }} [opts]
 * @returns {Promise<{ replies: Array<{ text: string }>, stateUpdates: Array<object> }>}
 */
export async function createHouseholdItem(noun, fields, ctx, opts = {}) {
  const { text, dueAt, assignee } = fields ?? {};
  const {
    emptyText = `Couldn't add — text is empty.`,
    reply     = (item) => `✓ added to ${item.type}: ${item.text}`,
  } = opts;

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      replies:      [{ text: emptyText }],
      stateUpdates: [],
    };
  }

  // TODO: messageId is not available in SkillContext — the agent strips that
  // detail before invoking skills.  Use '?' as a placeholder; the agent fills
  // it in once it lands (see implementation-plan.md "convergence" section).
  const item = await ctx.store.addItem({
    type:    noun,
    text:    text.trim(),
    addedBy: ctx.senderWebid,
    source:  { tg: { chatId: ctx.chatId, messageId: '?' } },
    ...(typeof dueAt === 'number' ? { dueAt } : {}),
  });

  // Optional immediate assignment (task noun).  Best-effort: a reassign hiccup
  // doesn't kill the user-facing "added" reply.
  if (typeof assignee === 'string' && assignee.trim() !== ''
      && typeof ctx.store.reassign === 'function') {
    try { await ctx.store.reassign(item.id, assignee.trim(), ctx.senderWebid); }
    catch (err) {
      // eslint-disable-next-line no-console
      console.error('[addTask] reassign threw:', err?.message ?? err);
    }
  }

  return {
    replies:      [{ text: reply(item) }],
    stateUpdates: [{ kind: 'item.added', itemId: item.id, chatId: ctx.chatId }],
  };
}

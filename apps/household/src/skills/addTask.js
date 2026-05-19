/**
 * skills/addTask — create a new task item.
 *
 * args  : { text: string, assignee?: string, dueAt?: number }
 * ctx   : SkillContext
 * reply : "✓ added task: <text>" + an `item.added` stateUpdate.
 *
 * When `assignee` is supplied, the task is reassigned to that webid
 * right after creation (single-pass; LWW).  SP-2 V0 has no inline DAG /
 * dependency wiring — those land via the manifest's forward-compat hook
 * to `@canopy/protocol` (PLAN guardrail #9).
 */

export async function addTask(args, ctx) {
  const { text, assignee, dueAt } = args ?? {};

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      replies:      [{ text: `Couldn't add task — text is empty.` }],
      stateUpdates: [],
    };
  }

  const item = await ctx.store.addItem({
    type:    'task',
    text:    text.trim(),
    addedBy: ctx.senderWebid,
    source:  { tg: { chatId: ctx.chatId, messageId: '?' } },
    ...(typeof dueAt === 'number' ? { dueAt } : {}),
  });

  // Optional immediate assignment.  Best-effort: a reassign hiccup
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
    replies:      [{ text: `✓ added task: ${item.text}` }],
    stateUpdates: [{ kind: 'item.added', itemId: item.id, chatId: ctx.chatId }],
  };
}

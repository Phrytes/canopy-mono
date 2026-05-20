/**
 * skills/registerName — register the user's display name as a contact.
 *
 * args  : { text: string }   // the display name.  Param named `text`
 *                              so the manifest's `'text-only'` slash
 *                              body shape lines up cleanly (F-SP2-a).
 * ctx   : SkillContext
 * reply : "✓ registered: <name>" + an `item.added` stateUpdate.
 *
 * SP-2 V0: writes a `contact` item to the household pod via the
 * existing Store seam (centralised path, in-memory or scaffolded
 * `HybridPodStore`).  The real shared-pod write acceptance is
 * device-gated (#47-class per PLAN §2.7) and lives behind a flag —
 * out of scope for this V0; default is the in-memory store.
 */

export async function registerName(args, ctx) {
  const { text } = args ?? {};

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      replies:      [{ text: `Couldn't register — name is empty.` }],
      stateUpdates: [],
    };
  }

  const item = await ctx.store.addItem({
    type:    'contact',
    text:    text.trim(),
    addedBy: ctx.senderWebid,
    source:  { tg: { chatId: ctx.chatId, messageId: '?' } },
  });

  return {
    replies:      [{ text: `✓ registered: ${item.text}` }],
    stateUpdates: [{ kind: 'item.added', itemId: item.id, chatId: ctx.chatId }],
  };
}

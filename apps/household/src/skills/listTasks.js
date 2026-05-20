/**
 * skills/listTasks — list open task items.
 *
 * args : { since?: number }
 * ctx  : SkillContext
 * reply: numbered list of open tasks; with one `[take — <id-prefix>]`
 *        inline button per task when the list is small (≤10).
 *
 * Emits no stateUpdates.  Mirrors `listOpen`'s shape; the difference
 * is the buttons map to `claim <id>` (the SP-2 verb) instead of
 * `done <id>`.
 */

const ID_PREFIX_LEN = 8;
const LABEL_MAX = 24;
const BUTTON_THRESHOLD = 10;

function shortLabel(text, fallback) {
  const t = String(text ?? '').trim();
  if (t.length === 0) return fallback;
  if (t.length <= LABEL_MAX) return t;
  return t.slice(0, LABEL_MAX - 1) + '…';
}

export async function listTasks(args, ctx) {
  const { since } = args ?? {};
  const items = await ctx.store.listOpen({ type: 'task', since });

  if (items.length === 0) {
    return {
      replies:      [{ text: `Nothing open in tasks.` }],
      stateUpdates: [],
    };
  }

  const lines   = items.map((it, idx) => `${idx + 1}. ${it.text}`);
  const message = { text: `tasks:\n${lines.join('\n')}` };

  if (items.length <= BUTTON_THRESHOLD) {
    message.buttons = items.map((it) => ({
      id:    `claim ${it.id}`,
      label: `Take ${shortLabel(it.text, it.id.slice(0, ID_PREFIX_LEN))}`,
    }));
  }

  return { replies: [message], stateUpdates: [] };
}

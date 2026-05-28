/**
 * skills/briefSummary — Q30 contributor for the canopy-chat /brief
 * aggregator.
 *
 * Returns a count of open household items + the topmost row so the
 * /brief fan-out can render a one-line "Household" section.
 *
 * Skill name in the manifest is `household_briefSummary` (matches
 * calendar's `calendar_briefSummary` + folio's `folio_briefSummary`
 * conventions — `<app>_briefSummary` so multi-app hosts can compose
 * the skills onto a shared agent without collisions).
 *
 * Reply shape mirrors folio's `folio_briefSummary` + calendar's
 * `briefSummary`: when the store is empty we return `{ok: true}`
 * (brief.js's isEmpty skips that section); otherwise we return
 * `{items, message}`.
 *
 * args : none (Q30 brief skills take no args)
 * ctx  : SkillContext (ctx.store.listOpen())
 */

const MAX_ITEMS = 5;

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function briefSummary(_args, ctx) {
  const open = await ctx.store.listOpen({});
  if (!open || open.length === 0) {
    return {
      replies: [{ ok: true }],  // brief.js's isEmpty skips this section
      stateUpdates: [],
    };
  }
  const items = open.slice(0, MAX_ITEMS).map((it) => ({
    id:    it.id,
    label: it.text,
  }));
  const message = `${open.length} open household item${open.length === 1 ? '' : 's'}`;
  return {
    replies: [{ items, message }],
    stateUpdates: [],
  };
}

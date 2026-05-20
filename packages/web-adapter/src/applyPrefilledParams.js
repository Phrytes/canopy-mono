/**
 * applyPrefilledParams — merge an affordance's `prefilledParams`
 *                       (Q6 of renderWeb) into a skill-call's args.
 *
 * Per renderWeb's Q6 (locked 2026-05-20): when an op surfaces in a
 * section via the type-enum fallback (e.g. household's `addItem(type:
 * shopping|errand|repair|schedule, text)`), the section's itemType is
 * recorded in `affordance.prefilledParams = { type: <section.itemType> }`
 * so the web adapter can pre-fill the `type` param when dispatching
 * the skill. Without this, the LLM-shaped single-type tool can't be
 * driven from a multi-section UI.
 *
 * Both Affordance.prefilledParams and ItemAction.prefilledParams use
 * the same shape; this helper works on both.
 *
 * Merge order (user-supplied wins):
 *   1. Start with `prefilledParams` (manifest-declared defaults).
 *   2. Overlay `args` (user-supplied at call time).
 *
 * Rationale for user-wins: prefilledParams are projector-derived
 * (renderWeb scopes them by section); the caller may legitimately
 * override (e.g. a UI tool surface that surfaces the same op across
 * multiple sections needs to pass an explicit type per click). When
 * the prefill is meant to be authoritative the caller simply doesn't
 * pass that key.
 *
 * Discipline:
 *   - Returns a NEW object (no mutation of either input).
 *   - Treats both args missing as "{}" so the result is always a
 *     plain object.
 *   - When the affordance / action has no `prefilledParams`, returns a
 *     shallow clone of args.
 *
 * @param {object} args               user-supplied call args
 * @param {{prefilledParams?: object}} affordance   affordance or itemAction
 * @returns {object}
 */
export function applyPrefilledParams(args, affordance) {
  const prefilled = affordance?.prefilledParams;
  if (!prefilled || typeof prefilled !== 'object') {
    return { ...(args ?? {}) };
  }
  return { ...prefilled, ...(args ?? {}) };
}

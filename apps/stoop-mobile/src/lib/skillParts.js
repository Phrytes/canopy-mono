/**
 * skillParts — pure helper for wrapping skill arguments in the
 * A2A `parts` shape. Lifted out of `useSkill.js` so vitest can
 * import it without going through ServiceContext (which has JSX).
 */

/**
 * Wrap an args object into the A2A `parts` shape expected by skills.
 * Already-wrapped arrays pass through.
 *
 * @param {object | object[]} args
 * @returns {object[]}
 */
export function toParts(args) {
  if (Array.isArray(args)) return args;
  if (args == null)        return [];
  return [{ type: 'DataPart', data: args }];
}

/**
 * Unwrap a parts array returned by `agent.invoke()` — pulls the first
 * DataPart's `data` field, mirroring `apps/stoop/web/app.js#callSkill`.
 *
 * `agent.invoke` resolves to `result.parts` (array of A2A Parts), not
 * the skill's return value. The canonical contract is:
 *   `[{type: 'DataPart', data: <return value>}, ...optional file parts]`
 *
 * Skill returns `{items: [...]}` therefore arrive as
 *   `[{type: 'DataPart', data: {items: [...]}}]`
 * — consumers want the inner object.  Falls back to `{}` when no
 * DataPart is present (e.g. a skill that returned plain `undefined`).
 *
 * @param {unknown} parts
 * @returns {object}
 */
export function unwrapParts(parts) {
  if (!Array.isArray(parts)) return parts ?? {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

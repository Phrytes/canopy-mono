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

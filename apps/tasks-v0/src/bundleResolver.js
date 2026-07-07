/**
 * bundleResolver — V2.8 single-agent dispatch primitive.
 *
 * `(parts, ctx) → CrewState | null` returns the per-crew state a
 * skill body should operate on. Lives outside `wireSkills` so the
 * mobile app + tests + multi-crew CLI can mix-and-match strategies.
 *
 * Two ready-made strategies:
 *
 *   - `singleCrewResolver(crewState)` — always returns the same
 *     CrewState. Used by single-crew launches (web app, most tests,
 *     the V0 zero-config path). Skills don't need to pass `circleId`.
 *
 *   - `multiCrewResolver(crews)` — picks the right CrewState from a
 *     `Map<circleId, CrewState>`. Strict resolution order:
 *       1. `args.circleId` from the first DataPart
 *       2. `args._scope` from the first DataPart (mobile React
 *          bindings inject `_scope: activeBundle.groupId` — same
 *          value as the circleId; see
 *          `packages/sync-engine-rn/src/react/createReactBindings.js`)
 *       3. `<circleId>/...` prefix on `envelope.topic`
 *       4. strict `null` (no silent fallback to "first crew")
 *
 *     Strict-null-on-miss is intentional. Silent fallback would
 *     route a multi-crew leak as a successful single-crew op.
 */

/** Read the first DataPart's `.data` from a Parts[] input. */
function _argsFromParts(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * Build a single-crew resolver. Every call returns `crewState`.
 *
 * @param {object} crewState
 * @returns {(parts: Array, ctx?: object) => object}
 */
export function singleCrewResolver(crewState) {
  if (!crewState) {
    throw new TypeError('singleCrewResolver: crewState required');
  }
  return () => crewState;
}

/**
 * Build a multi-crew resolver. Returns `null` when no crew matches.
 *
 * @param {Map<string, object>} crews
 * @returns {(parts: Array, ctx?: object) => object | null}
 */
export function multiCrewResolver(crews) {
  if (!(crews instanceof Map)) {
    throw new TypeError('multiCrewResolver: Map<circleId, CrewState> required');
  }
  return (parts, ctx = {}) => {
    const args = _argsFromParts(parts);
    if (typeof args.circleId === 'string' && args.circleId) {
      return crews.get(args.circleId) ?? null;
    }
    // Phase 41.18 follow-up: mobile React bindings inject
    // `_scope: activeBundle.groupId` (which equals the circleId) on
    // every skill call. Honour it so the multi-crew resolver
    // dispatches correctly without each screen having to plumb
    // circleId through manually.
    if (typeof args._scope === 'string' && args._scope) {
      const cs = crews.get(args._scope);
      if (cs) return cs;
    }
    const topic = ctx?.envelope?.topic;
    if (typeof topic === 'string' && topic) {
      const slash = topic.indexOf('/');
      const id = slash >= 0 ? topic.slice(0, slash) : topic;
      if (crews.has(id)) return crews.get(id);
    }
    return null;
  };
}

/** Helper used by skill bodies that need raw args after the resolve. */
export function argsFromParts(parts) {
  return _argsFromParts(parts);
}

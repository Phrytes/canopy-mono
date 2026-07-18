/**
 * bundleResolver — single-agent dispatch primitive.
 *
 * `(parts, ctx) → CircleState | null` returns the per-circle state a
 * skill body should operate on. Lives outside `wireSkills` so the
 * mobile app + tests + multi-circle CLI can mix-and-match strategies.
 *
 * Two ready-made strategies:
 *
 *   - `singleCircleResolver(circleState)` — always returns the same
 *     CircleState. Used by single-circle launches (web app, most tests,
 *     the V0 zero-config path). Skills don't need to pass `circleId`.
 *
 *   - `multiCircleResolver(circles)` — picks the right CircleState from a
 *     `Map<circleId, CircleState>`. Strict resolution order:
 *       1. `args.circleId` from the first DataPart
 *       2. `args._scope` from the first DataPart (mobile React
 *          bindings inject `_scope: activeBundle.groupId` — same
 *          value as the circleId; see
 *          `packages/sync-engine-rn/src/react/createReactBindings.js`)
 *       3. `<circleId>/...` prefix on `envelope.topic`
 *       4. strict `null` (no silent fallback to "first circle")
 *
 *     Strict-null-on-miss is intentional. Silent fallback would
 *     route a multi-circle leak as a successful single-circle op.
 */

/** Read the first DataPart's `.data` from a Parts[] input. */
function _argsFromParts(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * Build a single-circle resolver. Every call returns `circleState`.
 *
 * @param {object} circleState
 * @returns {(parts: Array, ctx?: object) => object}
 */
export function singleCircleResolver(circleState) {
  if (!circleState) {
    throw new TypeError('singleCircleResolver: circleState required');
  }
  return () => circleState;
}

/**
 * Build a multi-circle resolver. Returns `null` when no circle matches.
 *
 * @param {Map<string, object>} circles
 * @returns {(parts: Array, ctx?: object) => object | null}
 */
export function multiCircleResolver(circles) {
  if (!(circles instanceof Map)) {
    throw new TypeError('multiCircleResolver: Map<circleId, CircleState> required');
  }
  return (parts, ctx = {}) => {
    // Workstream B — the LOCAL route (`createTasksService().callSkill` calling a
    // pure core directly) has the decoded args already; it passes them on
    // `ctx.args` so the resolver doesn't force a synthetic `[DataPart(args)]`
    // round-trip just to read `circleId`.  The WIRE route never sets `ctx.args`,
    // so it reads `circleId` from `parts` exactly as before (byte-identical).
    const args = (ctx && ctx.args && typeof ctx.args === 'object') ? ctx.args : _argsFromParts(parts);
    if (typeof args.circleId === 'string' && args.circleId) {
      return circles.get(args.circleId) ?? null;
    }
    // Phase 41.18 follow-up: mobile React bindings inject
    // `_scope: activeBundle.groupId` (which equals the circleId) on
    // every skill call. Honour it so the multi-circle resolver
    // dispatches correctly without each screen having to plumb
    // circleId through manually.
    if (typeof args._scope === 'string' && args._scope) {
      const cs = circles.get(args._scope);
      if (cs) return cs;
    }
    const topic = ctx?.envelope?.topic;
    if (typeof topic === 'string' && topic) {
      const slash = topic.indexOf('/');
      const id = slash >= 0 ? topic.slice(0, slash) : topic;
      if (circles.has(id)) return circles.get(id);
    }
    return null;
  };
}

/** Helper used by skill bodies that need raw args after the resolve. */
export function argsFromParts(parts) {
  return _argsFromParts(parts);
}

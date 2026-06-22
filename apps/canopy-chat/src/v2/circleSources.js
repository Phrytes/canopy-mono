/**
 * canopy-chat v2 — circle sources adapter (shared web + mobile).
 *
 * Maps the host's dispatch onto the `loadCircles` fetchers, reusing
 * EXISTING ops only — `getMyCrews` (tasks crews, shape
 * `{crews:[{crewId,name,kind,counts}]}`) and `getCurrentGroup` (the stoop
 * buurt record behind `/groups`) — plus an optional `@canopy/circles`
 * store. No new ops are invented; the host injects `callSkill` (web: its
 * dispatch; mobile: hostOps) so the same adapter drives both launchers.
 */

export function circleSourcesFromAgent({ callSkill, circlesStore } = {}) {
  const call = async (opId, args) => {
    if (typeof callSkill !== 'function') return null;
    return callSkill(opId, args ?? {});
  };

  return {
    fetchCrews: async () => {
      const res = await call('getMyCrews');
      return Array.isArray(res?.crews) ? res.crews : [];
    },
    fetchGroups: async () => {
      // listMyBuurts → { buurts: [groupId, ...] } — ALL buurts the actor is
      // in (incl. one just created via createGroupV2). getCurrentGroup only
      // returned the single active buurt, so new circles never surfaced.
      const res = await call('listMyBuurts');
      const buurts = Array.isArray(res?.buurts) ? res.buurts : [];
      return buurts.map((b) => (typeof b === 'string' ? { id: b, name: b } : b));
    },
    fetchCircles: circlesStore
      ? async () => (await circlesStore.list()) ?? []
      : undefined,
  };
}

/** App origins probed when resolving an op to its owning app (both surfaces). */
export const DEFAULT_CIRCLE_ORIGINS = ['stoop', 'tasks', 'household', 'calendar', 'folio'];

// Perf #2 (2026-05-30) — does `catalog` declare `opId` on `origin`?
// The merged catalog stores ops under either the bare `opId` (then
// `entry.appOrigin` names the source) OR `'<origin>/<opId>'` for
// disambiguated declarations.  Treat either form as a hit.  Returns
// `true` when no catalog is supplied so callers without one keep the
// legacy probe-everything behaviour.
function catalogHasOp(catalog, origin, opId) {
  if (!catalog || typeof catalog !== 'object' || !catalog.opsById) return true;
  if (catalog.opsById.get(`${origin}/${opId}`)) return true;
  const bare = catalog.opsById.get(opId);
  return !!(bare && bare.appOrigin === origin);
}

// Positive-only: does the catalog POSITIVELY declare `opId` on `origin`? Unlike
// catalogHasOp it does NOT default-true on a missing catalog — used to decide
// whether the catalog "knows" an op anywhere (so the gate only filters ops the
// catalog actually placed, never agent-skill ops absent from every manifest).
function catalogDeclaresOp(catalog, origin, opId) {
  if (!catalog || typeof catalog !== 'object' || !catalog.opsById) return false;
  if (catalog.opsById.get(`${origin}/${opId}`)) return true;
  const bare = catalog.opsById.get(opId);
  return !!(bare && bare.appOrigin === origin);
}

/**
 * Wrap a host's 3-arg `callSkill(appOrigin, opId, args)` into the 2-arg
 * `callSkill(opId, args)` the circle helpers expect, by probing each app
 * origin and returning the first non-null result. Web's `agent.callSkill`
 * and mobile's `bundle.callSkill` share this signature, so both reuse it.
 *
 * `catalog` is optional but recommended: when supplied, the resolver
 * skips origins whose manifests don't declare `opId`, which avoids
 * pointless transport round-trips for aspirational ops (Perf #2,
 * 2026-05-30).  Pass the merged catalog returned by `mergeManifests`.
 */
export function makeResolvingCallSkill(rawCallSkill, origins = DEFAULT_CIRCLE_ORIGINS, catalog = null) {
  // `catalog` may be a live GETTER (so a later rescope — app toggle / policy.apps
  // — is honoured) or a static object. Resolved per call.
  const getCatalog = typeof catalog === 'function' ? catalog : () => catalog;
  return async (opId, args) => {
    if (typeof rawCallSkill !== 'function') return null;
    const cat = getCatalog();
    // The catalog gate (Perf #2) skips an origin the catalog says doesn't declare
    // the op — but ONLY when the catalog positively knows the op on SOME origin
    // (an "aspirational op" like getFeed/listNotes declared elsewhere). Essential
    // circle-source ops that are AGENT skills, not manifest ops — `getMyCrews`
    // (tasks), `listMyBuurts` (stoop) — appear on NO origin in the catalog, so the
    // per-origin gate used to skip them everywhere → loadCircles returned nothing →
    // "No circles yet" on every reload. When the op is unknown to the catalog, try
    // all origins (the gate is a perf hint, not a hard filter).
    const knownSomewhere = origins.some((app) => catalogDeclaresOp(cat, app, opId));
    for (const app of origins) {
      if (knownSomewhere && !catalogHasOp(cat, app, opId)) continue;
      try {
        const r = await rawCallSkill(app, opId, args ?? {});
        if (r != null) return r;
      } catch { /* try next origin */ }
    }
    return null;
  };
}

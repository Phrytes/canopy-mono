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
      const res = await call('getCurrentGroup');
      return toGroupArray(res);
    },
    fetchCircles: circlesStore
      ? async () => (await circlesStore.list()) ?? []
      : undefined,
  };
}

/** `getCurrentGroup` returns a single buurt record (possibly wrapped) — coerce to an array. */
function toGroupArray(res) {
  if (!res) return [];
  const g = res.group ?? res.current ?? res;
  if (!g || typeof g !== 'object') return [];
  const id = g.id ?? g.groupId ?? g.circleId ?? g.crewId;
  return id ? [g] : [];
}

/** App origins probed when resolving an op to its owning app (both surfaces). */
export const DEFAULT_CIRCLE_ORIGINS = ['stoop', 'tasks-v0', 'household', 'calendar', 'folio'];

/**
 * Wrap a host's 3-arg `callSkill(appOrigin, opId, args)` into the 2-arg
 * `callSkill(opId, args)` the circle helpers expect, by probing each app
 * origin and returning the first non-null result. Web's `agent.callSkill`
 * and mobile's `bundle.callSkill` share this signature, so both reuse it.
 */
export function makeResolvingCallSkill(rawCallSkill, origins = DEFAULT_CIRCLE_ORIGINS) {
  return async (opId, args) => {
    if (typeof rawCallSkill !== 'function') return null;
    for (const app of origins) {
      try {
        const r = await rawCallSkill(app, opId, args ?? {});
        if (r != null) return r;
      } catch { /* try next origin */ }
    }
    return null;
  };
}

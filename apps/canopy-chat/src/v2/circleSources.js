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

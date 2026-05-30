/**
 * canopy-chat v2 — peer ↔ circle reverse index (5.6).
 *
 * Inbound messages arrive by peer addr / WebID; the existing MemberMap
 * answers `webid → member`, but each MemberMap is scoped to ONE circle.
 * Override enforcement (5.7) needs the inverse: "for THIS inbound peer,
 * which circles am I in with them?" — so the right per-circle override
 * (chat-off, agents-filter) can apply.
 *
 * `GroupsIndex` is the pure data structure (a bidirectional set-of-sets)
 * that holds that mapping.  `bindMemberMap(circleId, mm)` is a small
 * subscription helper: it does an initial sync from the MemberMap and
 * then mirrors `member-added` / `member-removed` events into the index.
 *
 * No DOM, no IO — every method is sync.  The host wires this in once
 * per process; 5.7 reads it on the inbound delivery path.
 */

export class GroupsIndex {
  /** @type {Map<string, Set<string>>} webid → circleIds */
  #byWebid = new Map();
  /** @type {Map<string, Set<string>>} circleId → webids */
  #byCircle = new Map();

  /** Record that `webid` is a member of `circleId`.  Idempotent. */
  add(circleId, webid) {
    if (typeof circleId !== 'string' || !circleId) return;
    if (typeof webid    !== 'string' || !webid)    return;
    let cs = this.#byWebid.get(webid);
    if (!cs) { cs = new Set(); this.#byWebid.set(webid, cs); }
    cs.add(circleId);
    let ms = this.#byCircle.get(circleId);
    if (!ms) { ms = new Set(); this.#byCircle.set(circleId, ms); }
    ms.add(webid);
  }

  /** Remove the (circleId, webid) edge.  Cleans up empty sets. */
  remove(circleId, webid) {
    const cs = this.#byWebid.get(webid);
    if (cs) {
      cs.delete(circleId);
      if (cs.size === 0) this.#byWebid.delete(webid);
    }
    const ms = this.#byCircle.get(circleId);
    if (ms) {
      ms.delete(webid);
      if (ms.size === 0) this.#byCircle.delete(circleId);
    }
  }

  /** Drop a whole circle (e.g. on leave) — clears its membership edges. */
  removeCircle(circleId) {
    const ms = this.#byCircle.get(circleId);
    if (!ms) return;
    for (const webid of ms) {
      const cs = this.#byWebid.get(webid);
      if (cs) {
        cs.delete(circleId);
        if (cs.size === 0) this.#byWebid.delete(webid);
      }
    }
    this.#byCircle.delete(circleId);
  }

  /** All circles `webid` is a member of (insertion-order array). */
  groupsFor(webid) {
    const cs = this.#byWebid.get(webid);
    return cs ? [...cs] : [];
  }

  /** All webids in `circleId`. */
  membersOf(circleId) {
    const ms = this.#byCircle.get(circleId);
    return ms ? [...ms] : [];
  }

  /** True iff `webid` is recorded as a member of `circleId`. */
  has(circleId, webid) {
    return !!this.#byCircle.get(circleId)?.has(webid);
  }

  clear() {
    this.#byWebid.clear();
    this.#byCircle.clear();
  }
}

/**
 * Bind a MemberMap to a GroupsIndex under a `circleId`.  Performs an
 * initial sync (every existing webid → add) and then listens for
 * `member-added` / `member-removed` to keep the index live.  Returns an
 * unbind function the host calls on circle leave / teardown.
 *
 * Tolerant to a MemberMap-shaped object without `.list()` (e.g. tests
 * that pass an array of members directly).
 *
 * @param {GroupsIndex} index
 * @param {string} circleId
 * @param {object} memberMap   { list?: () => Promise<members[]>, on?, off? }
 * @returns {() => void}       unbind
 */
export async function bindMemberMap(index, circleId, memberMap) {
  if (!(index instanceof GroupsIndex)) {
    throw new TypeError('bindMemberMap: GroupsIndex required');
  }
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('bindMemberMap: circleId required');
  }
  if (!memberMap) return () => {};

  // Initial sync.
  const initial = typeof memberMap.list === 'function'
    ? await memberMap.list()
    : (Array.isArray(memberMap) ? memberMap : []);
  for (const m of initial) {
    if (m?.webid) index.add(circleId, m.webid);
  }

  // Subscribe (best-effort — MemberMap is an Emitter; tests may pass a
  // plain object without on/off, which is fine: initial sync still works).
  const onAdd = (m) => { if (m?.webid) index.add(circleId, m.webid); };
  const onRem = (m) => { if (m?.webid) index.remove(circleId, m.webid); };
  if (typeof memberMap.on === 'function') {
    memberMap.on('member-added',   onAdd);
    memberMap.on('member-updated', onAdd);    // idempotent
    memberMap.on('member-removed', onRem);
  }

  return function unbind() {
    if (typeof memberMap.off === 'function') {
      memberMap.off('member-added',   onAdd);
      memberMap.off('member-updated', onAdd);
      memberMap.off('member-removed', onRem);
    }
    index.removeCircle(circleId);
  };
}

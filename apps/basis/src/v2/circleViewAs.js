/**
 * basis v2 — "View as…" reveal/openness projection (shared, board 4C).
 *
 * A read-only preview of a circle's member directory as a *chosen viewer*
 * would see it — re-running the reveal/openness rules, not new data.  The
 * viewer is a member, a stranger, or an agent; the circle's `revealPolicy`
 * ('open' | 'pairwise') plus each member's pairwise reveals decide whether
 * the viewer sees a real name or just a handle.  Pure projection over the
 * member list (host supplies it from the identity-resolver MemberMap); web
 * + mobile share this, the renderers are thin.
 */

/** Who you can preview the circle as. */
export const VIEWER_KINDS = ['member', 'stranger', 'agent'];

/**
 * @typedef {object} CircleMember
 * @property {string}   id
 * @property {string}   [handle]    pseudonymous display (always visible)
 * @property {string}   [realName]  revealed only per the rules below
 * @property {string[]} [reveals]   viewer ids this member has revealed their real name to (pairwise)
 */

/**
 * Project the directory as `viewer` sees it.  A real name is visible when:
 *   - the row is the viewer themselves (a member always sees their own), OR
 *   - the viewer is a member AND (policy === 'open' OR the row revealed to them).
 * Strangers and agents never see real names (openness is member-to-member).
 *
 * @param {object}         [opts]
 * @param {CircleMember[]} [opts.members=[]]
 * @param {{id?: string, kind?: string}} [opts.viewer={}]
 * @param {'open'|'pairwise'} [opts.policy='pairwise']
 * @returns {{ id, handle, realName, displayName, revealed, self }[]}
 */
export function viewAsDirectory({ members = [], viewer = {}, policy = 'pairwise' } = {}) {
  const kind = VIEWER_KINDS.includes(viewer.kind) ? viewer.kind : 'member';
  const viewerId = viewer.id ?? null;
  const isMemberViewer = kind === 'member';
  return (members || [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const self = isMemberViewer && viewerId != null && m.id === viewerId;
      const revealedToViewer = isMemberViewer
        && viewerId != null
        && Array.isArray(m.reveals)
        && m.reveals.includes(viewerId);
      const seesRealName = self || (isMemberViewer && (policy === 'open' || revealedToViewer));
      const handle = m.handle ?? null;
      const realName = m.realName ?? null;
      return {
        id:          m.id,
        handle,
        realName,
        revealed:    !!seesRealName,
        self:        !!self,
        displayName: seesRealName ? (realName ?? handle ?? m.id) : (handle ?? m.id),
      };
    });
}

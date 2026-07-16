/**
 * H4 standard 5-role permission table.
 *
 * Per `Project Files/Substrates/apps/H4-tasks.md` § Roles + governance:
 * the canonical role-permission table that ships with H4 V0.  Apps
 * with custom roles add them via `customRoles` config (V1).
 *
 * The shape conforms to L1b's RolePolicy interface
 * (packages/item-store/src/types.js).
 */

/**
 * @typedef {'admin'|'coordinator'|'member'|'observer'|'external-volunteer'} StandardRole
 */

/**
 * Build a RolePolicy from a `webid → role` map.
 *
 * @param {Object<string, StandardRole>} roles
 * @param {object} [opts]
 * @param {Object<string, string>} [opts.aliases]
 *   Optional `actorAlias → webid` map (typically `pubKey → webid`).
 *   At skill-dispatch time the `from` field carries whatever the
 *   transport surfaces — on the desktop's HTTP path that's the
 *   localActor webid (via `LocalUiAuth`); on the mobile React path
 *   it's the agent's pubKey. The alias map lets a single roles
 *   table handle both.
 *
 *   **Deprecation (Phase 52.11):** when `actorResolver` is supplied,
 *   `aliases` is consulted only as a fallback if the resolver misses.
 *   A one-shot console warning fires the first time both are passed.
 *
 * @param {{ resolveSync?: (id: string) => {webid?: string}|null }} [opts.actorResolver]
 *   Phase 52.11 — agent-registry-backed bridge. When supplied, an
 *   incoming `actor` that isn't a direct webid is resolved through
 *   the registry to find its canonical webid before role lookup.
 *   The interface is intentionally narrow + **sync** — role policies
 *   gate every read/write, so the lookup must be cheap and
 *   non-promise. Wrap the agent-registry as a small in-process cache
 *   + sync accessor at app boot.
 *
 * @returns {import('@onderling/item-store').RolePolicy}
 */
export function buildStandardRolePolicy(roles, opts = {}) {
  const aliases       = opts.aliases ?? {};
  const actorResolver = opts.actorResolver ?? null;

  if (actorResolver && opts.aliases && !buildStandardRolePolicy._warnedAlias) {
    console.warn(
      '[buildStandardRolePolicy] both `actorResolver` and `aliases` supplied; ' +
      'resolver takes precedence. Drop the static alias map once the ' +
      'agent-registry migration is verified (Phase 52.11).',
    );
    buildStandardRolePolicy._warnedAlias = true;
  }

  const get = (actor) => {
    if (actor == null) return undefined;
    const direct = roles[actor];
    if (direct !== undefined) return direct;
    if (actorResolver && typeof actorResolver.resolveSync === 'function') {
      const record = actorResolver.resolveSync(actor);
      const webid  = record?.webid;
      if (typeof webid === 'string' && roles[webid] !== undefined) return roles[webid];
    }
    const aliased = aliases[actor];
    return aliased ? roles[aliased] : undefined;
  };
  return {
    canAdd: (actor) => {
      const r = get(actor);
      return r !== 'observer';
    },

    canClaim: (actor, item) => {
      const r = get(actor);
      if (r === undefined) return false;
      if (r === 'observer') return false;
      if (r === 'external-volunteer') {
        // External volunteers can only claim externally-friendly items
        // (per the H4 spec: "claim only tasks tagged external-friendly").
        return Boolean(item?.metadata?.externalFriendly);
      }
      return true;
    },

    canComplete: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      // V2.7 narrow exception: the targetAssignee on a subtask-proposal
      // closes their own proposal via approve/decline.
      if (item?.type === 'subtask-proposal'
          && item?.source?.targetAssignee === actor) {
        return true;
      }
      // member + external-volunteer: only complete tasks they're assigned to.
      return item?.assignee === actor;
    },

    canRemove: (actor) => {
      const r = get(actor);
      // Per H4 design: admin only can hard-remove.  Others use cancel
      // (which we model as a separate completed-with-reason flow,
      // V0 simplification).
      return r === 'admin';
    },

    canReassign: (actor) => {
      const r = get(actor);
      return r === 'admin' || r === 'coordinator';
    },

    canEditBody: (actor, item, patch) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      // member: only tasks they added.
      if (r === 'member' && item?.addedBy === actor) return true;
      // Phase 7 narrow exception: the parent's assignee OR master may
      // append to `dependencies` ONLY (not edit anything else). This
      // unblocks the sub-task spawn flow without granting full body-
      // edit rights. The patch must touch ONLY `dependencies`.
      if (patch && typeof patch === 'object'
          && Object.keys(patch).length === 1
          && Array.isArray(patch.dependencies)) {
        if (item?.assignee === actor) return true;
        if ((item?.master ?? item?.addedBy) === actor) return true;
      }
      // V2.4 narrow exception: the assignee may set `scheduledAt`
      // (and `estimateMinutes` if absent) on their own assignment via
      // the planner's `acceptSchedule` skill. Patch must touch ONLY
      // these planner fields — keeps the gate tight.
      if (patch && typeof patch === 'object' && item?.assignee === actor) {
        const keys = Object.keys(patch);
        const planner = ['scheduledAt', 'estimateMinutes'];
        if (keys.length > 0 && keys.every((k) => planner.includes(k))) return true;
      }
      // V2.7 narrow exception: the targetAssignee on a subtask-proposal
      // can edit the proposal's notes (used by declineSubtaskProposal
      // to record the optional decline note).
      if (item?.type === 'subtask-proposal'
          && item?.source?.targetAssignee === actor
          && patch && typeof patch === 'object'
          && Object.keys(patch).length === 1
          && 'notes' in patch) {
        return true;
      }
      return false;
    },

    canRead: (actor, item) => {
      const r = get(actor);
      if (r === undefined) return false;          // unknown actors → blocked
      if (r === 'observer') return true;          // observers can read everything
      // visibility filter:
      const v = item?.visibility ?? 'household';
      if (v === 'household') return true;
      if (v === 'private') return item?.addedBy === actor || item?.assignee === actor;
      if (typeof v === 'string' && v.startsWith('role:')) {
        const requiredRole = v.slice('role:'.length);
        return r === 'admin' || r === requiredRole;
      }
      return true;
    },

    // ── DoD-lifecycle gates (Tasks V1, Phase 5) ────────────────────────────

    /**
     * Submit a claimed item for approval. Default: the assignee
     * submits. Admins / coordinators can submit on someone's behalf
     * (rare, but handy for automation-by-coordinator flows).
     */
    canSubmit: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      return item?.assignee === actor;
    },

    /**
     * Approve a submitted item. Resolves the designated approver from
     * `item.approval`:
     *   - `'self-mark'` → no approval needed; admin/coord can still
     *     force-approve (rarely needed since markComplete works
     *     directly).
     *   - `'creator'`   → `addedBy` (or `master`) approves.
     *   - `'webid:X'`   → X approves.
     * Admin/coord override regardless of mode.
     */
    canApprove: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      const mode = item?.approval ?? 'self-mark';
      if (mode === 'self-mark') return item?.assignee === actor;
      if (mode === 'creator') {
        return item?.master === actor || item?.addedBy === actor;
      }
      if (typeof mode === 'string' && mode.startsWith('webid:')) {
        return mode.slice('webid:'.length) === actor;
      }
      return false;
    },

    /** Reject mirrors approve — same actors are allowed to push back. */
    canReject: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      const mode = item?.approval ?? 'self-mark';
      if (mode === 'creator') {
        return item?.master === actor || item?.addedBy === actor;
      }
      if (typeof mode === 'string' && mode.startsWith('webid:')) {
        return mode.slice('webid:'.length) === actor;
      }
      return false;
    },

    /**
     * Revoke (yank assignment, reason mandatory). Master-only,
     * admin/coord override. Members + external-volunteers can ONLY
     * revoke tasks they themselves master (sub-tasks they spawned).
     */
    canRevoke: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      return item?.master === actor;
    },
  };
}

/**
 * The default permission table — exported so tests / debug tools can
 * inspect it.  Shape matches the H4 spec table.
 */
export const STANDARD_ROLE_TABLE = Object.freeze({
  admin:               { add: true,  claim: true,        complete: 'any',  remove: true,  reassign: true,  editBody: 'any',  readPrivate: 'any' },
  coordinator:         { add: true,  claim: true,        complete: 'any',  remove: false, reassign: true,  editBody: 'any',  readPrivate: false },
  member:              { add: true,  claim: true,        complete: 'own',  remove: false, reassign: false, editBody: 'own',  readPrivate: false },
  observer:            { add: false, claim: false,       complete: false,  remove: false, reassign: false, editBody: false,  readPrivate: false },
  'external-volunteer':{ add: false, claim: 'tagged',    complete: 'own',  remove: false, reassign: false, editBody: false,  readPrivate: false },
});

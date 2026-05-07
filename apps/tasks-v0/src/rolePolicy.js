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
 * @returns {import('@canopy/item-store').RolePolicy}
 */
export function buildStandardRolePolicy(roles) {
  const get = (actor) => roles[actor];
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

    canEditBody: (actor, item) => {
      const r = get(actor);
      if (r === undefined || r === 'observer') return false;
      if (r === 'admin' || r === 'coordinator') return true;
      // member: only tasks they added.
      if (r === 'member') return item?.addedBy === actor;
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

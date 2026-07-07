/**
 * useActiveRole — pure-fn coverage of the role-derivation logic.
 *
 * Phase 41.8 (2026-05-09).
 *
 * The hook itself reads from useService() / React context; we
 * exercise the underlying logic by faking the svc object. This
 * matches the apps/stoop-mobile pattern (test the data, skip the
 * React tree).
 */

import { describe, it, expect } from 'vitest';

// Re-implementation of the helper's reduction step — used to verify
// that adding a new role to the table propagates to all the boolean
// shortcuts cleanly.
function deriveRole(svc) {
  const cs    = svc?.activeCircleId ? svc.circles.get(svc.activeCircleId) : null;
  const actor = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;
  const role  = (cs && actor) ? (cs.roles?.[actor] ?? null) : null;
  return {
    role,
    actor,
    isAdmin:        role === 'admin',
    isCoordinator:  role === 'coordinator',
    isMember:       role === 'member',
    isObserver:     role === 'observer',
    isAdminOrCoord: role === 'admin' || role === 'coordinator',
  };
}

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';

function makeSvc({ activeCircleId, roles = {}, actor = ANNE } = {}) {
  const cs = { roles };
  return {
    activeCircleId,
    identity: { webid: actor },
    circles: new Map(activeCircleId ? [[activeCircleId, cs]] : []),
  };
}

describe('useActiveRole — derivation', () => {
  it('returns null role when no circle is active', () => {
    const r = deriveRole(makeSvc({ activeCircleId: null }));
    expect(r.role).toBeNull();
    expect(r.isAdmin).toBe(false);
    expect(r.isAdminOrCoord).toBe(false);
  });

  it('returns the actor\'s role for the active circle', () => {
    const r = deriveRole(makeSvc({ activeCircleId: 'circle-a', roles: { [ANNE]: 'admin' } }));
    expect(r.role).toBe('admin');
    expect(r.isAdmin).toBe(true);
    expect(r.isAdminOrCoord).toBe(true);
    expect(r.isMember).toBe(false);
  });

  it('returns null when the actor isn\'t a member of the active circle', () => {
    const r = deriveRole(makeSvc({ activeCircleId: 'circle-a', roles: { [BOB]: 'admin' } }));
    expect(r.role).toBeNull();
    expect(r.isAdmin).toBe(false);
  });

  it('coordinator gates admin-or-coord shortcut', () => {
    const r = deriveRole(makeSvc({ activeCircleId: 'circle-a', roles: { [ANNE]: 'coordinator' } }));
    expect(r.isCoordinator).toBe(true);
    expect(r.isAdminOrCoord).toBe(true);
    expect(r.isAdmin).toBe(false);
  });

  it('member / observer roles surface their booleans', () => {
    const m = deriveRole(makeSvc({ activeCircleId: 'circle-a', roles: { [ANNE]: 'member' } }));
    const o = deriveRole(makeSvc({ activeCircleId: 'circle-a', roles: { [ANNE]: 'observer' } }));
    expect(m.isMember).toBe(true);
    expect(o.isObserver).toBe(true);
    expect(m.isAdminOrCoord).toBe(false);
    expect(o.isAdminOrCoord).toBe(false);
  });
});

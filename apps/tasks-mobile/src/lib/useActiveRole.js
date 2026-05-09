/**
 * useActiveRole — hook returning the caller's role in the active
 * crew, plus a per-role boolean shortcut.
 *
 * Phase 41.8 (2026-05-09).
 *
 * Used by every CrewSettings section to gate its UI:
 *   const { role, isAdmin, isCoordinator } = useActiveRole();
 *
 * The role table lives on `crewState.roles[webid]`; the actor webid
 * is the agent's identity. When no crew is active or the actor isn't
 * a member, returns `{role: null, isAdmin: false, ...}`.
 */

import { useService } from '../ServiceContext.js';

export function useActiveRole() {
  const svc = useService();
  const cs  = svc?.activeCrewId ? svc.crews.get(svc.activeCrewId) : null;
  const actor = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;
  const role = (cs && actor) ? (cs.roles?.[actor] ?? null) : null;

  return {
    role,
    actor,
    isAdmin:       role === 'admin',
    isCoordinator: role === 'coordinator',
    isMember:      role === 'member',
    isObserver:    role === 'observer',
    isAdminOrCoord: role === 'admin' || role === 'coordinator',
  };
}

/**
 * useActiveRole — hook returning the caller's role in the active
 * crew, plus a per-role boolean shortcut.
 *
 * Phase 41.8 (2026-05-09).
 * 41.18 follow-up — resolves the actor through the shared
 *                   `resolveActorRole` helper (in
 *                   `apps/tasks-v0/src/ui/effectiveActor.js`) so a
 *                   pubKey-based identity (mobile's default — no
 *                   pod attached, no real webid) finds its role
 *                   the same way the substrate's role policy does.
 *
 * Used by every CrewSettings section to gate its UI:
 *   const { role, isAdmin, isCoordinator } = useActiveRole();
 */

import { resolveActorRole } from '@canopy-app/tasks-v0/ui/effectiveActor';
import { useService } from '../ServiceContext.js';

export function useActiveRole() {
  const svc = useService();
  const cs  = svc?.activeCrewId ? svc.crews.get(svc.activeCrewId) : null;
  const actor = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;

  const role = resolveActorRole({ from: actor, crewState: cs });

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

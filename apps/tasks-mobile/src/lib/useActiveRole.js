/**
 * useActiveRole — hook returning the caller's role in the active
 * circle, plus a per-role boolean shortcut.
 *
 * Phase 41.8 (2026-05-09).
 * 41.18 follow-up — resolves the actor through the shared
 *                   `resolveActorRole` helper (in
 *                   `apps/tasks-v0/src/ui/effectiveActor.js`) so a
 *                   pubKey-based identity (mobile's default — no
 *                   pod attached, no real webid) finds its role
 *                   the same way the substrate's role policy does.
 *
 * Used by every CircleSettings section to gate its UI:
 *   const { role, isAdmin, isCoordinator } = useActiveRole();
 */

import { resolveActorRole } from '@onderling-app/tasks-v0/ui/effectiveActor';
import { useService } from '../ServiceContext.js';

export function useActiveRole() {
  const svc = useService();
  const cs  = svc?.activeCircleId ? svc.circles.get(svc.activeCircleId) : null;
  const actor = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;

  const role = resolveActorRole({ from: actor, circleState: cs });

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

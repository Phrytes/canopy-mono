/**
 * basis v2 — claim router (follow-up).
 *
 * When the local user claims a task in a circle AND the circle's personal
 * override has `flowThrough.tasksToPersonal === true`, the claim should
 * ALSO mirror into the user's personal task list ("Mijn dingen") so the
 * task can be tracked across circles.  The existing pure predicate
 * `shouldRouteClaimToPersonal` (5.7a) is the gate; this module wraps it
 * in the orchestration the realAgent's `afterClaimHook` calls after a
 * successful `claimTask`.
 *
 * The original circle-bound task is NOT modified — we mirror, not move.
 * The mirror carries:
 *   - `text`              = the claimed task's text/title
 *   - `originCircleId`    = the circle the claim came from
 *   - `originCircleName`  = the human-readable circle label (when known)
 *   - `originTaskId`      = the original task's id (for de-dup + back-link)
 *   - `tag: 'via:<circleId>'` so the CircleDetail "ON YOUR LIST" section
 *                           can filter (follow-up).
 *
 * Pure / DI: tests drive the helper with stub `getOverride` + a sink
 * `addToPersonalCircle`; no real agent / no storage needed.
 */
import { shouldRouteClaimToPersonal } from './circleEnforcement.js';

/**
 * Orchestrate the post-claim mirror.
 *
 * @param {object}  args
 * @param {object}  args.task                claimed task (post-skill shape: {id, text|title, ...})
 * @param {string}  args.circleId            origin circle id
 * @param {string}  [args.circleName]        human label for the via-tag
 * @param {(id: string) => Promise<object|null>} args.getOverride
 * @param {(payload: {text:string, originCircleId:string, originCircleName?:string, originTaskId?:string, tag:string}) => Promise<object|null>} args.addToPersonalCircle
 * @returns {Promise<{routed:boolean, mirroredTaskId?:string|null, reason?:string}>}
 */
export async function routeClaim({ task, circleId, circleName, getOverride, addToPersonalCircle } = {}) {
  if (!task || typeof task !== 'object') return { routed: false, reason: 'no-task' };
  if (typeof circleId !== 'string' || !circleId) return { routed: false, reason: 'no-circle' };
  if (typeof addToPersonalCircle !== 'function') return { routed: false, reason: 'no-sink' };

  let route = false;
  try {
    route = await shouldRouteClaimToPersonal({ circleId, getOverride });
  } catch {
    return { routed: false, reason: 'override-read-failed' };
  }
  if (!route) return { routed: false, reason: 'opted-out' };

  const text = pickText(task);
  if (!text) return { routed: false, reason: 'no-text' };

  let mirrored = null;
  try {
    mirrored = await addToPersonalCircle({
      text,
      originCircleId:   circleId,
      originCircleName: typeof circleName === 'string' ? circleName : undefined,
      originTaskId:     typeof task.id === 'string' ? task.id : null,
      tag:              `via:${circleId}`,
    });
  } catch (err) {
    return { routed: false, reason: 'sink-threw', detail: err?.message ?? String(err) };
  }
  return { routed: true, mirroredTaskId: mirrored?.id ?? mirrored?.itemId ?? null };
}

function pickText(task) {
  const cands = [task.text, task.title, task.label, task.name];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Build a host's `afterClaimHook` from a `getOverride` accessor + an
 * `addToPersonalCircle` sink.  The agent calls the resulting fn after
 * every successful `claimTask`; it returns `{routed, ...}` so the host
 * can log / surface the side-effect.
 */
export function makeAfterClaimHook({ getOverride, addToPersonalCircle, resolveCircleName } = {}) {
  return async function afterClaimHook({ task, circleId } = {}) {
    if (!circleId) return { routed: false, reason: 'no-circle' };
    let circleName;
    if (typeof resolveCircleName === 'function') {
      try { circleName = await resolveCircleName(circleId); } catch { /* optional */ }
    }
    return routeClaim({ task, circleId, circleName, getOverride, addToPersonalCircle });
  };
}

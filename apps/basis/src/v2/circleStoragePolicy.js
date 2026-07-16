/**
 * circleStoragePolicy — bridge the circle's local `pod` axis to stoop's
 * authoritative four-tier circle storage policy.
 *
 * A circle is a stoop circle ([[circleid-crewid-alias]]); stoop owns the REAL
 * storage-tier decision (admin-gated, one-way — `setCircleStoragePolicy` /
 * `getCircleStoragePolicy` in apps/stoop/src/skills). basis's circle
 * settings expose a local `pod` enum (`none|shared|personal|hybrid`) that, until
 * now, went nowhere. This module is the pure mapping + the call orchestration
 * (over an injected `callSkill`) so a circle admin's pod choice actually drives
 * stoop's `podRouting.setCirclePolicy`. Web + mobile share this; the shells inject
 * their `callSkill` + active circle id.
 *
 * The `pod` axis ↔ stoop tier is 1:1:
 *   none → no-pod · shared → centralised · personal → decentralised · hybrid → hybrid
 *
 * NB this is the STORAGE-TIER axis (where shared content lives), distinct from
 * `storagePosture` (p0-p3 — the at-rest sealing posture the per-circle pod
 * PRODUCER reads). The two are orthogonal and set independently.
 */

/** Circle `pod` enum → stoop storage tier. */
export const POD_TO_TIER = Object.freeze({
  none:     'no-pod',
  shared:   'centralised',
  personal: 'decentralised',
  hybrid:   'hybrid',
});

/** stoop storage tier → circle `pod` enum (inverse of POD_TO_TIER). */
export const TIER_TO_POD = Object.freeze({
  'no-pod':        'none',
  'centralised':   'shared',
  'decentralised': 'personal',
  'hybrid':        'hybrid',
});

/** Map a circle `pod` value to a stoop tier (defaults to 'no-pod' for unknowns). */
export function podAxisToTier(pod) {
  return POD_TO_TIER[pod] ?? 'no-pod';
}

/** Map a stoop tier back to a circle `pod` value (defaults to 'none' for unknowns). */
export function tierToPodAxis(tier) {
  return TIER_TO_POD[tier] ?? 'none';
}

/**
 * Read the circle's current storage tier from stoop and return it as a `pod`
 * axis value (so the settings form can hydrate the radio). Best-effort: any
 * error → null (the form keeps its local value).
 *
 * @param {object} a
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} a.callSkill
 * @param {string} a.circleId  the circle id (= stoop groupId)
 * @returns {Promise<{pod:string, groupPodUri:string|null}|null>}
 */
export async function loadCircleStoragePod({ callSkill, circleId } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return null;
  try {
    const r = await callSkill('stoop', 'getCircleStoragePolicy', { groupId: circleId });
    if (!r || typeof r !== 'object' || r.error) return null;
    return { pod: tierToPodAxis(r.policy), groupPodUri: r.groupPodUri ?? null };
  } catch {
    return null;
  }
}

/**
 * Push a circle's chosen `pod` value to stoop's circle storage policy. Admin-only
 * + one-way (no downgrade to no-pod) are enforced BY THE SKILL — this surfaces
 * the result/error verbatim so the shell can show a localized notice.
 *
 * @param {object} a
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} a.callSkill
 * @param {string} a.circleId       the circle id (= stoop groupId)
 * @param {string} a.pod            the circle `pod` axis value
 * @param {string} [a.groupPodUri]  required by stoop for centralised/hybrid
 * @returns {Promise<{ok:true, storage:object}|{ok:false, error:string}>}
 */
export async function pushCircleStoragePolicy({ callSkill, circleId, pod, groupPodUri } = {}) {
  if (typeof callSkill !== 'function') return { ok: false, error: 'no-callskill' };
  if (!circleId) return { ok: false, error: 'groupId required' };
  const storagePolicy = podAxisToTier(pod);
  let r;
  try {
    r = await callSkill('stoop', 'setCircleStoragePolicy', {
      groupId: circleId,
      storagePolicy,
      ...(groupPodUri ? { groupPodUri } : {}),
    });
  } catch (e) {
    return { ok: false, error: `storage-policy-write-failed:${e?.message ?? 'unknown'}` };
  }
  if (!r || typeof r !== 'object') return { ok: false, error: 'no-result' };
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, storage: r.storage ?? null };
}

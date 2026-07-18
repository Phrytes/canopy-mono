/**
 * basis v2 — circle override enforcement (5.7).
 *
 * Pure decision functions the host wires into its inbound paths once
 * the substrate from 5.6 (GroupsIndex + MemberMap.relation='agent') is
 * present.  Three knobs, three predicates:
 *
 *   - `isInboundChatOff(...)`        → drop / silence an inbound when
 *                                      this user has `override.chatOff`
 *                                      set for ANY circle the sender is
 *                                      in with them.
 *   - `isInboundAgentBlocked(...)`   → drop an inbound from a peer
 *                                      whose `MemberMap.relation` is
 *                                      `'agent'` when the user (or the
 *                                      circle policy) says agents may
 *                                      not contact them.
 *   - `shouldRouteClaimToPersonal(...)` → when claiming a task in a
 *                                      circle where the user set
 *                                      `flowThrough.tasksToPersonal`,
 *                                      route the resulting "mine" task
 *                                      into the personal circle instead
 *                                      of leaving it in the circle's.
 *
 * Every predicate is host-injection-shaped: the caller passes the data
 * accessors (groupsIndex, getOverride, getCirclePolicy, memberMap), so
 * the substrate stays unit-testable without touching the secure-agent
 * factory or the tasks substrate.  5.7c (the follow-up) wires these
 * into secure-agent's mute-fanout and the household notifier.
 */

/* ──────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────── */

async function _getOverride(getOverride, circleId) {
  if (typeof getOverride !== 'function') return null;
  try { return await getOverride(circleId); }
  catch { return null; }
}

async function _getPolicy(getCirclePolicy, circleId) {
  if (typeof getCirclePolicy !== 'function') return null;
  try { return await getCirclePolicy(circleId); }
  catch { return null; }
}

/* ──────────────────────────────────────────────────────────────────
 * Chat-off: drop an inbound the user's circle override silenced.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Returns true when the inbound from `peerWebid` should be dropped
 * because the local user has set `override.chatOff = true` for ANY
 * circle they share with that peer.
 *
 * `groupsIndex.groupsFor(peerWebid)` is consulted to find the shared
 * circles; for each, `getOverride(circleId)` is read.  The local user
 * is in control of their own overrides — this is "my settings stop
 * inbound from peers in muted circles," not a peer-side block.
 *
 * Returns false when no shared circles are recorded (e.g. a stranger
 * has no relation yet) — the caller's other gates (mute-set, helloGate)
 * still apply.
 *
 * @param {object} args
 * @param {string} args.peerWebid
 * @param {{groupsFor: (webid: string) => string[]}} args.groupsIndex
 * @param {(circleId: string) => Promise<{chatOff?: boolean}|null>} args.getOverride
 * @returns {Promise<boolean>}
 */
export async function isInboundChatOff({ peerWebid, groupsIndex, getOverride } = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (!groupsIndex || typeof groupsIndex.groupsFor !== 'function') return false;
  const circles = groupsIndex.groupsFor(peerWebid);
  for (const circleId of circles) {
    const ov = await _getOverride(getOverride, circleId);
    if (ov?.chatOff === true) return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────────
 * Agent filter: drop inbound from a peer marked relation:'agent'
 * when this circle (or the user) says agents may not contact them.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Returns true when the inbound from `peerWebid` should be dropped
 * because the peer is recorded as an `agent` (5.6 MemberMap marker)
 * AND either:
 *   - the user's `override.agentsMayContactMe === false`, OR
 *   - the circle's `policy.agents === 'no'`.
 *
 * The decision is scoped to a known `circleId` — the caller looks up
 * the circle from the inbound envelope (e.g. via `groupsIndex.groupsFor`
 * + selecting the active scope) and passes it in.  When the peer is
 * NOT recorded as an agent in that circle's MemberMap, returns false.
 *
 * @param {object} args
 * @param {string} args.peerWebid
 * @param {string} args.circleId
 * @param {{resolveByWebid: (webid: string) => Promise<{relation?: string}|null>}} args.memberMap
 * @param {(circleId: string) => Promise<{agents?: string}|null>} args.getCirclePolicy
 * @param {(circleId: string) => Promise<{agentsMayContactMe?: boolean}|null>} args.getOverride
 * @returns {Promise<boolean>}
 */
export async function isInboundAgentBlocked({
  peerWebid, circleId, memberMap, getCirclePolicy, getOverride,
} = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (typeof circleId  !== 'string' || !circleId)  return false;
  if (!memberMap || typeof memberMap.resolveByWebid !== 'function') return false;

  const member = await memberMap.resolveByWebid(peerWebid).catch(() => null);
  if (!member || member.relation !== 'agent') return false;

  // Circle policy: 'no' is a hard veto on agent inbound.
  const policy = await _getPolicy(getCirclePolicy, circleId);
  if (policy?.agents === 'no') return true;

  // Personal override: explicit opt-out from agent contact in this circle.
  const ov = await _getOverride(getOverride, circleId);
  if (ov?.agentsMayContactMe === false) return true;

  return false;
}

/* ──────────────────────────────────────────────────────────────────
 * Flow-through: claimed tasks land in the personal circle.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Pure router decision: when the local user claims a task in `circleId`
 * AND has `override.flowThrough.tasksToPersonal === true`, the claim
 * should land in the personal circle rather than staying in the circle's.
 * `5.7c` (the follow-up) wires this into the tasks claim handler to
 * actually re-scope the resulting task.
 *
 * @param {object} args
 * @param {string} args.circleId
 * @param {(circleId: string) => Promise<{flowThrough?: {tasksToPersonal?: boolean}}|null>} args.getOverride
 * @returns {Promise<boolean>}
 */
export async function shouldRouteClaimToPersonal({ circleId, getOverride } = {}) {
  if (typeof circleId !== 'string' || !circleId) return false;
  const ov = await _getOverride(getOverride, circleId);
  return ov?.flowThrough?.tasksToPersonal === true;
}

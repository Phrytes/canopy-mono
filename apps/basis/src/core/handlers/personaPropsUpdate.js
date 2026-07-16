/**
 * Post-join "share to this circle" — property layer.
 *
 * Lets an already-joined MEMBER push the coarse persona properties they now disclose to a circle
 * up to that circle's ADMIN, who records them on the roster (`stoop.recordMemberPersonaProperties`).
 * The general/post-join counterpart of the join-time capture that rides the redeem (`groupRedeem.js`):
 * same authority model (the admin owns the roster; webid == the mesh signing address, so a member
 * speaks only for their own row), a direct twin of the `group-redeem-request`/`-response` pattern.
 *
 * Three factories mirror groupRedeem's trio:
 *   - `makeSendPersonaPropsUpdate` (MEMBER side) — sends a `persona-props-update` envelope to the
 *     admin + awaits the matching `persona-props-ack` with a timeout (via a caller-owned pendingMap).
 *   - `makeHandlePersonaPropsUpdate` (ADMIN side) — records `fromAddr`'s properties onto the roster
 *     and replies `persona-props-ack`. Trusts `fromAddr` for the member identity, never the payload.
 *   - `makeHandlePersonaPropsAck` (MEMBER side) — resolves the pending promise.
 *
 * Plus `shareDisclosureToCircle` — the member-side orchestrator the "About me" surface calls: it
 * computes the persona's release for the circle, finds the admin, and routes local-vs-peer.
 */

/**
 * MEMBER-side outbound: send this member's disclosed persona properties for `groupId` to the admin
 * and await the ack. Mirror of `makeSendGroupRedeemRequest`.
 *
 * @param {object} args
 * @param {(addr: string, payload: object) => Promise<*>} args.sendPeer
 * @param {() => boolean}                                  [args.isPeerConnected]
 * @param {Map<string, {resolve: Function, reject: Function, timer?: any}>} args.pendingMap
 * @param {(groupId: string) => (string|null)}             [args.circleAddressFor]  present the per-circle address, like the redeem
 * @param {number}                                         [args.timeoutMs=30000]
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(args: {adminPeerAddr: string, groupId: string, personaProperties: object}) => Promise<{ok?: boolean, error?: string}>}
 */
export function makeSendPersonaPropsUpdate({
  sendPeer, isPeerConnected, pendingMap, circleAddressFor, timeoutMs = 30_000, logger = console,
} = {}) {
  if (typeof sendPeer !== 'function') {
    throw new Error('makeSendPersonaPropsUpdate: sendPeer required');
  }
  if (!pendingMap || typeof pendingMap.set !== 'function') {
    throw new Error('makeSendPersonaPropsUpdate: pendingMap required (Map-shaped)');
  }
  const peerUp = () => (typeof isPeerConnected !== 'function' ? true : !!isPeerConnected());

  return async function sendPersonaPropsUpdate({ adminPeerAddr, groupId, personaProperties }) {
    if (!peerUp()) {
      throw new Error('Peer transport not connected. Try /peer-connect first.');
    }
    // Present THIS device's per-circle address (like the redeem) so the update speaks the same
    // per-circle identity the admin already recorded. Additive — never block on its absence.
    let circleAddress = null;
    if (typeof circleAddressFor === 'function') {
      try { circleAddress = circleAddressFor(groupId) ?? null; }
      catch { circleAddress = null; }
    }
    const requestId = `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMap.delete(requestId);
        reject(new Error('Admin did not confirm within 30 s. They may be offline — try again later.'));
      }, timeoutMs);
      pendingMap.set(requestId, { resolve, reject, timer });
    });
    try {
      await sendPeer(adminPeerAddr, {
        type:    'p2p-chat',
        subtype: 'persona-props-update',
        requestId,
        groupId,
        // Empty {} is a valid "I now share nothing here" — send it so the admin clears the slot.
        personaProperties: (personaProperties && typeof personaProperties === 'object') ? personaProperties : {},
        ...(circleAddress ? { circleAddress } : {}),
        sentAt: Date.now(),
      });
    } catch (err) {
      const entry = pendingMap.get(requestId);
      if (entry) {
        try { clearTimeout(entry.timer); } catch { /* defensive */ }
        pendingMap.delete(requestId);
      }
      logger.warn?.('[persona-props] send failed', adminPeerAddr, err);
      throw new Error(`Failed to reach admin over NKN: ${err?.message ?? err}`);
    }
    return promise;
  };
}

/**
 * ADMIN-side inbound: record the member's disclosed properties onto the roster + reply an ack.
 * Mirror of `makeHandleGroupRedeemRequest`.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                  args.sendPeer
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandlePersonaPropsUpdate({
  callSkill, sendPeer, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandlePersonaPropsUpdate: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeHandlePersonaPropsUpdate: sendPeer required');

  return async function handlePersonaPropsUpdate(fromAddr, payload) {
    const { requestId, groupId, personaProperties, circleAddress } = payload ?? {};
    if (!requestId || !groupId) {
      logger.warn?.('[peer] persona-props-update missing fields', payload);
      return;
    }
    let reply;
    try {
      const result = await callSkill('stoop', 'recordMemberPersonaProperties', {
        groupId,
        // Trust the authenticated peer address for the member identity, NEVER the payload — a member
        // can only speak for their own row (webid == the mesh signing address in this architecture).
        memberWebid: fromAddr,
        personaProperties: (personaProperties && typeof personaProperties === 'object') ? personaProperties : {},
        ...(circleAddress ? { circleAddress } : {}),
      });
      reply = (result?.ok === false) ? { error: result.reason ?? 'record-failed' } : { ok: true };
    } catch (err) {
      reply = { error: err?.message ?? String(err) };
    }
    try {
      await sendPeer(fromAddr, {
        type: 'p2p-chat', subtype: 'persona-props-ack', requestId, ...reply, sentAt: Date.now(),
      });
      if (reply.ok) {
        publishEvent?.({
          app: 'stoop', type: 'notification',
          payload: { message: `🔄 ${String(fromAddr).slice(0, 16)}… updated what they share in ${groupId}` },
        });
      }
    } catch (err) {
      logger.error?.('[peer] persona-props-ack send failed', err);
    }
  };
}

/**
 * MEMBER-side inbound: resolve the pending update promise. Mirror of `makeHandleGroupRedeemResponse`.
 *
 * @param {object} args
 * @param {Map<string, {resolve: Function, timer?: any}>} args.pendingMap
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandlePersonaPropsAck({ pendingMap, logger = console } = {}) {
  if (!pendingMap || typeof pendingMap.get !== 'function') {
    throw new Error('makeHandlePersonaPropsAck: pendingMap required (Map-shaped)');
  }
  return function handlePersonaPropsAck(_fromAddr, payload) {
    const requestId = payload?.requestId;
    const entry = pendingMap.get(requestId);
    if (!entry) {
      logger.warn?.('[peer] persona-props-ack with no pending entry', requestId);
      return;
    }
    if (entry.timer) { try { clearTimeout(entry.timer); } catch { /* defensive */ } }
    pendingMap.delete(requestId);
    entry.resolve(payload);
  };
}

/**
 * Member-side orchestrator behind the "About me" per-circle "share to this circle" button. Computes
 * the persona's release for the circle, finds the circle admin, then routes:
 *
 *   - LOCAL when there is no remote admin — this is the admin's OWN circle (`listGroupRoster`
 *     excludes self, so an admin viewing their own circle sees no admin entry) → record directly.
 *   - PEER otherwise — push the release to the admin over `persona-props-update`.
 *
 * An empty release ({}) still propagates: pressing "share" after toggling everything off is how a
 * member CLEARS what they disclosed. Returns `{ok:true, ...}` | `{ok:false, reason}`.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(args: {adminPeerAddr: string, groupId: string, personaProperties: object}) => Promise<*>} [args.sendPersonaUpdate]
 * @param {string} args.circleId
 * @param {string} args.personaId
 * @returns {Promise<{ok: boolean, via?: 'local'|'peer', reason?: string}>}
 */
export async function shareDisclosureToCircle({ callSkill, sendPersonaUpdate, circleId, personaId }) {
  if (typeof callSkill !== 'function') return { ok: false, reason: 'callSkill-required' };
  if (!circleId || !personaId) return { ok: false, reason: 'missing-args' };

  // 1. What this persona discloses in THIS circle (its release for the context).
  let personaProperties = {};
  try {
    const rel = await callSkill('agents', 'getPersonaRelease', { id: personaId, contextId: circleId });
    personaProperties = (rel?.released && typeof rel.released === 'object') ? rel.released : {};
  } catch { personaProperties = {}; }

  // 2. Find the circle admin (excluded from listGroupRoster when it's ME → drives local-vs-peer).
  let adminAddr = null;
  try {
    const roster = await callSkill('stoop', 'listGroupRoster', { groupId: circleId });
    adminAddr = (Array.isArray(roster?.members) ? roster.members : []).find((m) => m?.role === 'admin')?.addr ?? null;
  } catch { adminAddr = null; }

  // 3a. No remote admin ⇒ I AM the admin of this circle ⇒ update my roster directly.
  if (!adminAddr) {
    try {
      const r = await callSkill('stoop', 'recordMemberPersonaProperties', { groupId: circleId, personaProperties });
      return (r?.ok === false) ? { ok: false, reason: r.reason ?? 'record-failed' } : { ok: true, via: 'local' };
    } catch (err) { return { ok: false, reason: err?.message ?? 'record-failed' }; }
  }

  // 3b. Remote admin ⇒ push over peer.
  if (typeof sendPersonaUpdate !== 'function') return { ok: false, reason: 'admin-unreachable' };
  try {
    const r = await sendPersonaUpdate({ adminPeerAddr: adminAddr, groupId: circleId, personaProperties });
    return (r && r.error) ? { ok: false, reason: r.error } : { ok: true, via: 'peer' };
  } catch (err) { return { ok: false, reason: err?.message ?? 'admin-unreachable' }; }
}

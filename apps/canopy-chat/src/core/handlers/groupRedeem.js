/**
 * Inbound group-redeem handlers.  Bundle H Phase 2 (#269) — lifted
 * from `apps/canopy-chat/web/main.js:679` + `:789` (#202 fallback
 * over NKN).
 *
 * Two paired flows:
 *
 *   - `makeHandleGroupRedeemRequest` (ADMIN side) — verifies a
 *     joiner's membership code via `stoop.verifyMembershipCodeForPeer`
 *     + replies with `group-redeem-response`.  On success, fires
 *     `propagateMeshIntros` so newly-consenting members see each
 *     other's addresses.
 *
 *   - `makeHandleGroupRedeemResponse` (JOINER side) — looks up the
 *     pending request by `requestId` in a caller-owned `pendingMap`
 *     and resolves its promise so the /join-group flow can complete.
 *     The pending map is platform state (web's Map lives in main.js);
 *     we inject it for parity.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                  args.sendPeer
 * @param {(args: {groupId: string, newPeerAddr: string, newPeerDisplay?: string, newPeerShared?: boolean}) => Promise<*>} [args.propagateMeshIntros]
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandleGroupRedeemRequest({
  callSkill, sendPeer, propagateMeshIntros, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleGroupRedeemRequest: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeHandleGroupRedeemRequest: sendPeer required');

  return async function handleGroupRedeemRequest(fromAddr, payload) {
    const { requestId, groupId, code, shareCard, peerDisplay, circleAddress, personaProperties } = payload ?? {};
    if (!requestId || !groupId || !code) {
      logger.warn?.('[peer] group-redeem-request missing fields', payload);
      return;
    }
    let reply;
    try {
      const result = await callSkill('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code,
        requesterWebid: fromAddr,
        ...(shareCard   ? { shareCard: true } : {}),
        ...(peerDisplay ? { peerDisplay }     : {}),
        // Identity 5B/C — the JOINER's per-circle address, forwarded from their
        // request envelope so the admin records it into the roster. Self-asserted
        // (the joiner speaks only for the address THEY present here).
        ...(circleAddress ? { circleAddress } : {}),
        // Property layer — the joiner's disclosed persona properties, forwarded to the admin's roster.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
      });
      if (result?.error) {
        reply = { error: result.error };
      } else {
        reply = { ok: true, codeId: result.codeId, validUntil: result.validUntil };
      }
    } catch (err) {
      reply = { error: err?.message ?? String(err) };
    }
    try {
      await sendPeer(fromAddr, {
        type:    'p2p-chat',
        subtype: 'group-redeem-response',
        requestId,
        ...reply,
        sentAt:  Date.now(),
      });
      publishEvent?.({
        app: 'stoop', type: 'notification',
        payload: {
          message: reply.ok
            ? `📥 ${String(fromAddr).slice(0, 16)}… joined ${groupId} (peer-confirmed)`
            : `⚠ rejected join attempt for ${groupId}: ${reply.error}`,
        },
      });
      if (reply.ok && typeof propagateMeshIntros === 'function') {
        propagateMeshIntros({
          groupId,
          newPeerAddr:    fromAddr,
          newPeerDisplay: peerDisplay,
          newPeerShared:  !!shareCard,
        }).catch((err) => logger.warn?.('[mesh-intro] propagation failed', err));
      }
    } catch (err) {
      logger.error?.('[peer] group-redeem-response send failed', err);
    }
  };
}

/**
 * JOINER-side outbound: sends a `group-redeem-request` envelope to
 * the admin's peer address + awaits the matching response with a
 * timeout.  Returns a function that the joinGroup wizard can pass
 * as `sendPeerRedeem` to `finalSubmit`.  Mirror of web's
 * `sendGroupRedeemRequest` in `apps/canopy-chat/web/main.js:532`.
 *
 * Bundle H Phase 4 (#271) — final piece of the cross-instance
 * group-redeem flow on mobile.  The same `pendingMap` is wired into
 * `makeHandleGroupRedeemResponse` so inbound responses resolve the
 * promise.
 *
 * @param {object} args
 * @param {(addr: string, payload: object) => Promise<*>} args.sendPeer
 * @param {() => boolean}                                  [args.isPeerConnected]
 * @param {Map<string, {resolve: Function, reject: Function, timer?: any}>} args.pendingMap
 * @param {(groupId: string) => (string|null)}             [args.circleAddressFor]  identity 5B/C — per-circle address presenter
 * @param {number}                                         [args.timeoutMs=30000]
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(args: {adminPeerAddr: string, groupId: string, code: string, shareCard?: boolean, peerDisplay?: string}) => Promise<{ok?: boolean, codeId?: string, validUntil?: number, error?: string}>}
 */
export function makeSendGroupRedeemRequest({
  sendPeer, isPeerConnected, pendingMap, circleAddressFor, timeoutMs = 30_000, logger = console,
} = {}) {
  if (typeof sendPeer !== 'function') {
    throw new Error('makeSendGroupRedeemRequest: sendPeer required');
  }
  if (!pendingMap || typeof pendingMap.set !== 'function') {
    throw new Error('makeSendGroupRedeemRequest: pendingMap required (Map-shaped)');
  }
  const peerUp = () =>
    typeof isPeerConnected !== 'function' ? true : !!isPeerConnected();

  return async function sendGroupRedeemRequest({
    adminPeerAddr, groupId, code, shareCard, peerDisplay, personaProperties,
  }) {
    if (!peerUp()) {
      throw new Error('Peer transport not connected. Try /peer-connect first.');
    }
    // Identity 5B/C — present THIS device's per-circle address for `groupId` on
    // the cross-instance (peer) redeem path, mirroring the direct path's
    // callSkill-seam injection. Computed here from the resolved groupId so the
    // joiner-side logic lives once (both platforms bind the same fn at boot).
    let circleAddress = null;
    if (typeof circleAddressFor === 'function') {
      try { circleAddress = circleAddressFor(groupId) ?? null; }
      catch { circleAddress = null; /* additive — never block the peer redeem */ }
    }
    const requestId = `gr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMap.delete(requestId);
        reject(new Error('Admin did not respond within 30 s. They may be offline — try again later.'));
      }, timeoutMs);
      pendingMap.set(requestId, { resolve, reject, timer });
    });
    try {
      await sendPeer(adminPeerAddr, {
        type:    'p2p-chat',
        subtype: 'group-redeem-request',
        requestId,
        groupId,
        code,
        ...(shareCard   ? { shareCard: true } : {}),
        ...(peerDisplay ? { peerDisplay }     : {}),
        ...(circleAddress ? { circleAddress } : {}),
        // Property layer — the joiner's disclosed persona properties (from finalSubmit), forwarded to the admin.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
        sentAt: Date.now(),
      });
    } catch (err) {
      const entry = pendingMap.get(requestId);
      if (entry) {
        try { clearTimeout(entry.timer); } catch { /* defensive */ }
        pendingMap.delete(requestId);
      }
      logger.warn?.('[group-redeem] send failed', adminPeerAddr, err);
      throw new Error(`Failed to reach admin over NKN: ${err?.message ?? err}`);
    }
    return promise;
  };
}

/**
 * @param {object} args
 * @param {Map<string, {resolve: Function, timer?: any}>} args.pendingMap   the live request-id → entry map
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandleGroupRedeemResponse({
  pendingMap, logger = console,
} = {}) {
  if (!pendingMap || typeof pendingMap.get !== 'function') {
    throw new Error('makeHandleGroupRedeemResponse: pendingMap required (Map-shaped)');
  }
  return function handleGroupRedeemResponse(_fromAddr, payload) {
    const requestId = payload?.requestId;
    const entry = pendingMap.get(requestId);
    if (!entry) {
      logger.warn?.('[peer] group-redeem-response with no pending entry', requestId);
      return;
    }
    if (entry.timer) {
      try { clearTimeout(entry.timer); } catch { /* defensive */ }
    }
    pendingMap.delete(requestId);
    entry.resolve(payload);
  };
}

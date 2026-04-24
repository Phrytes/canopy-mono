/**
 * keyRotation — Group FF receive-path handler.
 *
 * When a peer rotates its Ed25519 identity it broadcasts a proof to
 * everyone in its PeerGraph (see `identity/KeyRotation.broadcast`).  We
 * receive it as a one-way envelope whose payload has:
 *
 *   { type: 'key-rotation', proof: <KeyRotationProof> }
 *
 * This handler verifies the proof, migrates the peer's SecurityLayer
 * and PeerGraph records from oldPubKey to newPubKey, and emits a
 * `peer-rotated` event the app can react to.  Unrelated to the agent's
 * OWN rotation (see FF3 `agent.rotateIdentity`).
 *
 * Registration is always-on (not opt-in): rotation is safety-critical
 * and a peer that silently fails to migrate will black-hole messages
 * signed by the new key.  Agent._dispatch calls
 * `handleKeyRotationOW(agent, envelope)` at the top of the OW case and
 * short-circuits if it returns true.
 *
 * Receive-path only.  FF3 implements the send-path.
 */
import { KeyRotation } from '../identity/KeyRotation.js';
import * as P          from '../Envelope.js';

/**
 * Try to handle an OW envelope as a peer-rotation notification.
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — decrypted OW envelope
 * @returns {boolean} true if handled (caller should stop dispatching)
 */
export function handleKeyRotationOW(agent, envelope) {
  const payload = envelope.payload ?? {};
  if (payload.type !== 'key-rotation') return false;

  const proof = payload.proof;
  if (!proof || typeof proof !== 'object') {
    agent.emit('key-rotation-rejected', { reason: 'no-proof', from: envelope._from });
    return true;   // handled (albeit rejected) — don't dispatch further
  }

  // The envelope's sender must be the key being rotated FROM.  Without
  // this check a hostile peer could announce someone else's rotation.
  const senderKey = agent.security?.getPeerKey?.(envelope._from);
  if (senderKey && senderKey !== proof.oldPubKey) {
    agent.emit('key-rotation-rejected', {
      reason: 'sender-mismatch', from: envelope._from,
      expectedOld: senderKey, proofOld: proof.oldPubKey,
    });
    return true;
  }

  // Verify signature (over canonical {oldPubKey,newPubKey,issuedAt,gracePeriod,type}).
  if (!KeyRotation.verify(proof, proof.oldPubKey)) {
    agent.emit('key-rotation-rejected', { reason: 'bad-signature', from: envelope._from });
    return true;
  }

  // Grace period still open?  Beyond grace we still update the peer
  // mapping (so the new key works) but emit a distinct event so an app
  // that wants stricter semantics can reject late-arriving rotations.
  const inGrace = KeyRotation.isWithinGracePeriod(proof);

  // Migrate SecurityLayer — future envelopes signed by newPubKey verify.
  const migrated = agent.security?.migratePeerKey?.(proof.oldPubKey, proof.newPubKey) ?? 0;

  // Migrate PeerGraph: copy the old record under the new key and mark
  // both sides so routing / UI can surface the rotation.
  const peerGraphPromise = _migratePeerGraph(agent, proof).catch(err => {
    agent.emit('error', err);
  });

  // Migrate TrustRegistry if one is attached.
  let trustPromise = Promise.resolve();
  if (agent.trustRegistry) {
    trustPromise = KeyRotation.applyToRegistry(proof, agent.trustRegistry, { removeOld: false })
      .catch(err => agent.emit('error', err));
  }

  agent.emit('peer-rotated', {
    oldPubKey:  proof.oldPubKey,
    newPubKey:  proof.newPubKey,
    from:       envelope._from,
    inGrace,
    migrated,
    issuedAt:   proof.issuedAt,
    gracePeriod: proof.gracePeriod,
  });

  // Fire-and-forget async migrations — handler itself stays sync.
  void peerGraphPromise;
  void trustPromise;
  return true;
}

/**
 * Group FF+1 — exported form of the PeerGraph migration used by both
 * the OW broadcast receive path and the inline-proof receive path.
 * Idempotent: if called twice with the same proof the second call just
 * upserts the same record.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} proof — a verified KeyRotationProof
 */
export async function migratePeerGraph(agent, proof) {
  return _migratePeerGraph(agent, proof);
}

async function _migratePeerGraph(agent, proof) {
  const peers = agent.peers;
  if (!peers) return;

  const oldRec = await peers.get(proof.oldPubKey);
  if (!oldRec) {
    // Peer unknown to us — register the new key directly so gossip /
    // routing can discover it without a full hello round-trip.
    await peers.upsert({
      pubKey:       proof.newPubKey,
      rotatedFrom:  proof.oldPubKey,
      rotatedAt:    proof.issuedAt,
      discoveredVia: 'key-rotation',
    });
    return;
  }

  // Upsert the new record keyed by newPubKey, carrying over transports,
  // caps, and trust tier.  Do NOT copy `pubKey` from the old record; the
  // merged record must claim the new pubKey.
  const { pubKey: _drop, ...carryOver } = oldRec;
  await peers.upsert({
    ...carryOver,
    pubKey:      proof.newPubKey,
    rotatedFrom: proof.oldPubKey,
    rotatedAt:   proof.issuedAt,
    lastSeen:    Date.now(),
  });

  // Mark the old record as rotated so UIs can hide / grey it.
  await peers.upsert({
    pubKey:    proof.oldPubKey,
    rotatedTo: proof.newPubKey,
    rotatedAt: proof.issuedAt,
    reachable: false,
  });
}

// Re-export for tests / external use.
export { KeyRotation };

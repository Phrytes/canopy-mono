/**
 * companion-node R2b.2 — the DEVICE side of the `authorizePod` handshake.
 *
 * R2b.1 injected the delegated `PodCapabilityToken` into the host at boot. R2b.2
 * DELIVERS it over the wire: the device (the pod OWNER) mints a token that grants
 * a SPECIFIC host scoped pod access (issuer = owner, subject = host), then hands
 * it to the host's `pod.acceptDelegation` control op. The host verifies the grant
 * cryptographically — signature + `subject == host` + `issuer == configured owner`
 * — before installing it. See `scopedPodClient.js` + `index.js` for the host side.
 *
 * These are thin, testable functions:
 *   - `authorizePod(ownerIdentity, hostPubKey, {...})` — mint the token (pure
 *     issuance; no wire). The owner is the ISSUER; the host is the SUBJECT.
 *   - `deliverPodDelegation(deviceAgent, hostPubKey, token)` — deliver a minted
 *     token to the host over the relay and return the host's honest ack.
 *
 * HONESTY (same posture as the rest of R2b): the delivery rides the real relay +
 * RelayTransport, but enforcement is still IN-PROCESS on the host (the held
 * `FsBackedMockPodClient`, not a network pod). This is a REAL delegation trust
 * boundary — the host proves the token was delegated to IT by ITS owner — but NOT
 * yet a network-adversary boundary; that arrives with a real HTTP pod at R3.
 */
import { PodCapabilityToken, Parts } from '@onderling/core';

/** The control-op id the host registers to receive a pod delegation. */
export const ACCEPT_DELEGATION_OP = 'pod.acceptDelegation';

/**
 * Mint a `PodCapabilityToken` delegating scoped pod access from the owner (this
 * device) to a specific host. Issuer = owner, subject = host — the binding the
 * host enforces on receipt.
 *
 * @param {import('@onderling/core').AgentIdentity} ownerIdentity  the pod owner (issuer/signer)
 * @param {string} hostPubKey   the host's Ed25519 pubKey (base64url) — the token SUBJECT
 * @param {object} o
 * @param {string[]} o.scopes       e.g. ['pod.read:/notes/']
 * @param {string}   o.pod          pod root URI the token authorizes against
 * @param {number}   [o.expiresIn]  ms until expiry (default: PodCapabilityToken's 1h)
 * @param {object}   [o.constraints]
 * @returns {Promise<PodCapabilityToken>}
 */
export async function authorizePod(ownerIdentity, hostPubKey, { scopes, pod, expiresIn, constraints } = {}) {
  if (!ownerIdentity || typeof ownerIdentity.sign !== 'function') {
    throw new Error('authorizePod: ownerIdentity (an AgentIdentity) required');
  }
  if (!hostPubKey || typeof hostPubKey !== 'string') {
    throw new Error('authorizePod: hostPubKey (string) required');
  }
  return PodCapabilityToken.issue(ownerIdentity, {
    subject: hostPubKey,
    pod,
    scopes,
    ...(typeof expiresIn === 'number' ? { expiresIn } : {}),
    ...(constraints ? { constraints } : {}),
  });
}

/**
 * Deliver a minted delegation to the host over the wire and return its ack.
 *
 * @param {import('@onderling/core').Agent} deviceAgent  a started agent on the host's relay (hello'd)
 * @param {string} hostPubKey  the host's address
 * @param {PodCapabilityToken|object} token  the delegation to install
 * @returns {Promise<{ ok: boolean, error?: string, subject?: string, scopes?: string[], expiresAt?: number }>}
 */
export async function deliverPodDelegation(deviceAgent, hostPubKey, token) {
  const wire = token instanceof PodCapabilityToken ? token.toJSON() : token;
  const ack  = Parts.data(await deviceAgent.invoke(hostPubKey, ACCEPT_DELEGATION_OP, { token: wire }));
  return ack ?? { ok: false, error: 'delegation rejected' };
}

/**
 * basis v2 — the app-layer bridge that turns THIS device's network identity into the per-text OPENER
 * for received "shared with me" copies (SILENT out-of-circle delivery). ONE shared source, so web≡mobile get
 * the same opener by construction (invariants #2/#3): both shells call `openerForIdentity(identity)`.
 *
 * LAYERING (invariant #5): the X25519 sealing-key DERIVATION + the envelope `open` live in the
 * `@onderling/pod-client` ADAPTER, which the kernel (`@onderling/core` / `AgentIdentity`) must not depend UP on. So
 * the kernel exposes `AgentIdentity.sharedCopyOpener(deriveOpener)` — a hole the app fills with the adapter.
 * `deviceSharedCopyOpener` IS that injected builder: it derives the sealing keypair from the network secret and
 * returns `makeOpener(privateKey)`. The network secret is consumed HERE and never leaves — only the opener
 * CLOSURE escapes (the kernel hands the secret to this builder internally and returns only its result).
 *
 * The sender sealed the copy to `sealingPublicKeyFromNetworkKey(myPublishedNetworkKey)`; this opener holds the
 * matching private key from `sealingKeyPairFromNetworkKey(myNetworkSecret)`, so `open` (recipient mode) decrypts
 * it. A copy sealed to SOMEONE ELSE's key is a foreign envelope → `open` throws (deny-safe, never ciphertext).
 */
import { sealingKeyPairFromNetworkKey, makeOpener } from '@onderling/pod-client';

/**
 * The injected `deriveOpener` for `AgentIdentity.sharedCopyOpener`: `(networkSecretB64) => (text) => plaintext`.
 * Derives the X25519 sealing keypair from the Ed25519 network secret and returns the per-text `open` closure
 * bound to its PRIVATE key. The secret / private key never escape this closure.
 *
 * @param {string} networkSecretB64  b64url of the 32-byte seed OR 64-byte Ed25519 secret key
 * @returns {(text:string)=>string}  opens `fp1:` sealed text; passes plaintext through; throws on a foreign envelope
 */
export function deviceSharedCopyOpener(networkSecretB64) {
  const { privateKey } = sealingKeyPairFromNetworkKey(networkSecretB64);
  return makeOpener(privateKey);
}

/**
 * Build THIS device's shared-copy opener from its agent identity, or `null` when unavailable (no identity /
 * pre-`sharedCopyOpener` core) — a null opener makes a row tap a deny-safe no-op. The identity keeps its network
 * secret ENCAPSULATED: it hands the secret to `deviceSharedCopyOpener` internally and returns only the closure.
 *
 * @param {{sharedCopyOpener?:Function}|null} identity  the core AgentIdentity (e.g. `agent.sa.agent.identity`)
 * @returns {((text:string)=>string|Promise<string>)|null}
 */
export function openerForIdentity(identity) {
  if (!identity || typeof identity.sharedCopyOpener !== 'function') return null;
  try { return identity.sharedCopyOpener(deviceSharedCopyOpener); }
  catch { return null; }
}

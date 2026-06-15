/**
 * canopy-chat v2 — per-circle pod producer (S4 pod foundation, the structural slice).
 *
 * REMAINING-WORK §4 E2's blocker was: "canopy-chat builds one shared stoop agent,
 * not per-circle; nothing detects storagePosture ∈ {p2,p3}, creates member sealing
 * identities, instantiates createControlAgent, or wraps the circle pod-client." This
 * is that producer: for ONE circle it composes the S4 sealing substrate into a
 * per-circle storage producer —
 *   • a per-circle X25519 sealing identity (always, vault-backed), and
 *   • for a SEALED posture (p2/p3): a per-circle control agent over the circle's
 *     pod-client — bootstrapped, holding the recipient-wrapped group key, ready to
 *     grant/seal on join and revoke/rotate on leave (forward secrecy).
 *
 * It's the per-SCOPE producer that lives OUTSIDE the single stoop agent (one agent
 * per service-context; per-scope state outside — CLAUDE.md invariant #6). The app
 * keeps one of these per open circle, keyed by circle id.
 *
 * Deps are INJECTED (no hard `@canopy/pod-client` / `@canopy/pseudo-pod` import) so
 * this module stays portable for Metro/RN and unit-testable: the web host passes a
 * `makePodClient` that builds an in-memory pseudo-pod client (real per-circle sealed
 * storage in the browser, NO OIDC/CSS) — a real Solid pod-client is the env-gated
 * swap later. p0/p1 circles seal nothing → `controlAgent` is null (plain storage).
 */
import { createCircleSealingIdentity } from './circleSealingIdentity.js';
import { createCircleControlAgent } from './circleControlAgent.js';

const SEALED_POSTURES = new Set(['p2', 'p3']);

/** A no-op ACL sharing: an in-memory pseudo-pod has no ACL layer; real grant/revoke is env-gated. */
function memorySharing() {
  return { grant: async () => {}, revoke: async () => {} };
}

/**
 * @param {object} deps
 * @param {string} deps.circleId
 * @param {'p0'|'p1'|'p2'|'p3'} [deps.storagePosture]      from `circlePolicy.storagePosture`.
 * @param {{ get: Function, set: Function }} deps.vault     the app's key/value vault.
 * @param {Array<{webId:string, publicKey:string, role?:string}>} [deps.roster]  initial members.
 * @param {() => {publicKey:string, privateKey:string}} [deps.generateKeypair]  REQUIRED for p2/p3.
 * @param {(circleId:string) => {read:Function, write:Function}} [deps.makePodClient]  REQUIRED for p2/p3.
 * @param {{grant:Function, revoke:Function}} [deps.sharing]  ACL (defaults to a memory no-op).
 * @param {boolean} [deps.bootstrap=true]  bootstrap the control agent's key resource immediately.
 * @param {string} [deps.controllerKeyPrefix]
 * @returns {Promise<{circleId, storagePosture, sealingIdentity, controlAgent:(object|null), podClient:(object|null), circleRootUri:(string|null)}>}
 */
export async function createCirclePodProducer({
  circleId,
  storagePosture = 'p0',
  vault,
  roster = [],
  generateKeypair,
  makePodClient,
  sharing,
  bootstrap = true,
  controllerKeyPrefix = 'cc.circle-controller-key',
} = {}) {
  if (!circleId) throw new Error('createCirclePodProducer: circleId is required');
  if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function') {
    throw new Error('createCirclePodProducer: a vault with get/set is required');
  }

  // p0/p1 → no client-side seal, no control agent, NO sealing identity (a plaintext
  // circle never becomes a recipient). Skipping it keeps this path crypto-free, so it
  // runs in the browser where the sealing primitives (x25519/HKDF) are deliberately
  // stubbed — see the sealed branch below.
  if (!SEALED_POSTURES.has(storagePosture)) {
    return { circleId, storagePosture, sealingIdentity: null, controlAgent: null, podClient: null, circleRootUri: null };
  }

  // Sealed (p2/p3): a per-circle sealing identity (two circles never share one).
  // NB: the sealing keygen uses node:crypto x25519, which the canopy-chat BROWSER
  // bundle stubs out by design (browser-safe sealing — an async WebCrypto/@noble port
  // of `packages/pod-client/src/sealing/envelope.js` — is the next S4 gate). This whole
  // branch therefore runs today in Node/CI (proven by circlePodProducer.test.js) and
  // over a real Node pod, but NOT yet in the browser; the host calls this best-effort.
  const sealingIdentity = createCircleSealingIdentity({ circleId, store: vault });
  await sealingIdentity.ensure();
  if (typeof generateKeypair !== 'function' || typeof makePodClient !== 'function') {
    throw new Error('createCirclePodProducer: a sealed (p2/p3) circle needs generateKeypair + makePodClient');
  }

  // Per-circle controller keypair, persisted so the group key stays unwrappable for
  // THIS agent across reloads (the in-memory pod's group key itself is ephemeral; a
  // persistent backend / real pod is the durability follow-up).
  const ckKey = `${controllerKeyPrefix}:${circleId}`;
  let controllerKey = null;
  const stored = await vault.get(ckKey);
  if (stored) { try { controllerKey = JSON.parse(stored); } catch { controllerKey = null; } }
  if (!controllerKey?.publicKey || !controllerKey?.privateKey) {
    controllerKey = generateKeypair();
    await vault.set(ckKey, JSON.stringify(controllerKey));
  }

  const podClient = makePodClient(circleId);
  const circleRootUri = `pseudo-pod://circle-${circleId}/circle`;
  const controlAgent = createCircleControlAgent({
    circleId, storagePosture, podClient,
    sharing: sharing ?? memorySharing(),
    controllerKey, circleRootUri, roster,
  });
  if (bootstrap && controlAgent) await controlAgent.bootstrap();

  return { circleId, storagePosture, sealingIdentity, controlAgent, podClient, circleRootUri };
}

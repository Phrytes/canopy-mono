/**
 * circleControlAgent — compose a per-circle sealed-pod control agent (S4, pod
 * foundation; the SAFE offline-testable slice of REMAINING-WORK §4 E2).
 *
 * Wires the P3 sealing substrate into a single per-circle producer: a pod key
 * store (holds the versioned, recipient-wrapped group key) + a control agent that
 * grants/revokes pod ACL AND rotates the group key on membership change (forward
 * secrecy on leave). The `podClient` + `sharing` are INJECTED, so this is fully
 * unit-testable with an in-memory pod + mock sharing (no real Solid pod, no OIDC).
 *
 * Scope (deliberate): this constructs + drives the control agent and resolves the
 * content-sealing strategy; it does NOT yet restructure canopy-chat's single
 * shared stoop agent into per-circle agents, nor wire a real OIDC pod session —
 * those are the env-gated / restructuring phases that need a real pod to verify.
 * p0/p1 circles seal nothing → this returns `null` (the caller uses a plain client).
 */
import {
  createControlAgent, createPodKeyStore, resolveCircleStorage, readGroupKey,
} from '@canopy/pod-client';

const SEALED_POSTURES = new Set(['p2', 'p3']);

/**
 * @param {object} deps
 * @param {string} deps.circleId
 * @param {'p0'|'p1'|'p2'|'p3'} [deps.storagePosture]  from `circlePolicy.storagePosture`.
 * @param {{ read: Function, write: Function }} [deps.podClient]  a PodClient (real or in-memory).
 * @param {{ grant: Function, revoke: Function }} [deps.sharing]  pod ACL grant/revoke (real or mock).
 * @param {{ publicKey: string, privateKey: string }} [deps.controllerKey]  the agent's sealing keypair.
 * @param {string} [deps.circleRootUri]   the circle's pod container root (default a mem:// uri).
 * @param {Array<{ webId: string, publicKey: string, role?: string }>} [deps.roster]  initial members.
 * @returns {object|null}  the control-agent facade, or `null` for an unsealed (p0/p1) circle.
 */
export function createCircleControlAgent({
  circleId,
  storagePosture = 'p0',
  podClient,
  sharing,
  controllerKey,
  circleRootUri,
  roster = [],
} = {}) {
  if (!circleId) throw new Error('createCircleControlAgent: circleId is required');
  if (!SEALED_POSTURES.has(storagePosture)) return null;   // p0/p1 → no sealing, no control agent
  if (!podClient || !sharing || !controllerKey) {
    throw new Error('createCircleControlAgent: podClient, sharing, controllerKey are required for a sealed (p2/p3) circle');
  }

  const root = (circleRootUri ?? `mem://circle/${circleId}`).replace(/\/$/, '');
  const keyStore = createPodKeyStore({ podClient, uri: `${root}/.keys/group.json` });
  const agent = createControlAgent({
    sharing,
    // Grant members access to the WHOLE circle container — they need to read both
    // the per-recipient-wrapped group key (`${root}/.keys/`) AND the sealed content
    // (everything's encrypted, so a shared READ is safe) for true multi-device.
    containerUri: `${root}/`,
    keyStore,
    controllerKey,
    modes: ['read', 'write'],
    roster,
  });

  return {
    circleId,
    storagePosture,
    circleRootUri: root,
    agent,
    keyStore,
    bootstrap:    () => agent.bootstrap(),
    addMember:    (m) => agent.addMember(m),
    removeMember: (m) => agent.removeMember(m),
    members:      () => agent.members(),

    /**
     * Resolve the circle's CONTENT seal/open strategy once the caller's group key
     * is unwrappable (the member is a current recipient). Throws if revoked / not a
     * recipient (the group key was rotated away from them). p2 = group-key seal.
     *
     * @param {string} privateKey  the member's sealing private key.
     * @returns {Promise<{ seal: Function, open: Function } | null>}
     */
    async sealingStrategy(privateKey) {
      const groupKey = await readGroupKey({ keyStore, privateKey });
      return resolveCircleStorage({ posture: storagePosture, groupKey });
    },
  };
}

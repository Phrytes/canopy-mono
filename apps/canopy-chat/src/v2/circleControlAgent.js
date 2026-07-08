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
     * recipient (the group key was rotated away from them). Returns null when the
     * circle hasn't been bootstrapped yet (no key resource) — the caller then falls
     * back to a plain client rather than sealing with missing material.
     *
     * The group-key resource is the AUTHORISATION gate for BOTH sealed postures: a
     * member proves current membership by unwrapping it (a revoked/never-granted key
     * throws → the caller sees null, never plaintext). The resolved strategy then
     * differs by posture:
     *   • p2 — GROUP-KEY seal: content is encrypted under the shared `groupKey`.
     *   • p3 — RECIPIENT seal: content is sealed directly to the CURRENT roster's
     *          public keys (writer is host-blind) + opened with the member's own key.
     *          Recipients = every current member + the controller, taken from the
     *          control-agent roster so a p3 writer seals to exactly who can read.
     *
     * ── PLUMBING GAP (Phase 3 cross-version reader) ─────────────────────────────────
     * This p2 path still resolves ONLY the current group key (via `readGroupKey`), so
     * a still-entitled member cannot yet open p2 content sealed under an OLDER version
     * (before a rotation they lived through) — the cross-version reader is NOT wired in
     * here. The clean seam exists: pass the retained key RESOURCE + this private key to
     * `resolveCircleStorage({ posture: 'p2', resource, privateKey })` (its resource form
     * builds `groupKeyStrategy({ resource, privateKey })`, which opens across every
     * version the reader can unwrap while preserving forward secrecy). Doing so also
     * CHANGES this method's access contract — a revoked member would then get a
     * read-only historic strategy (opens pre-revocation content, cannot seal or open
     * post-revocation content) instead of the current blanket throw, and a never-member
     * would get `null` instead of a throw. That is an access-policy decision (it flips
     * several app-level security tests), left for review rather than silently wired.
     *
     * @param {string} privateKey  the member's sealing private key.
     * @returns {Promise<{ seal: Function, open: Function } | null>}
     */
    async sealingStrategy(privateKey) {
      const groupKey = await readGroupKey({ keyStore, privateKey });
      if (groupKey == null) return null;   // not bootstrapped → plain client (no seal with missing key)
      if (storagePosture === 'p3') {
        // Content is recipient-sealed, not group-key-sealed: gather the current roster's
        // public keys (+ the controller, always a recipient) so a writer seals to all
        // members. `groupKey` above only served as the membership gate (already passed).
        const recipients = [...new Set([
          ...agent.members().map((m) => m.publicKey),
          controllerKey.publicKey,
        ].filter(Boolean))];
        return resolveCircleStorage({ posture: 'p3', recipients, privateKey });
      }
      return resolveCircleStorage({ posture: storagePosture, groupKey });
    },
  };
}

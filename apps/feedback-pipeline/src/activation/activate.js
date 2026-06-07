// Activation orchestration (build proposal §1.2 / architecture §1.2). The activation
// service: validates a cohort code → has the SUBSTRATE provision the participant's pod
// (the injected `provisionPod` — in production this calls @canopy/pod-onboarding
// createPodOnboarding + ACP templates + creates the central-pod container; keys come
// from @canopy/vault, generated client-side) → injects the project CONFIG at runtime
// (one image for everyone, never per-participant) → redeems the code and stores only
// the recovery-hash ↔ pod-ref record. It never stores names, email, or identity.
//
// `provisionPod` is injected (like pod-onboarding injects its podProvisioner) so this
// orchestration is testable with a stub; the real one is wired in the infra phase.
//
// Optional identity registration (PR-3, the HI handshake): if the participant supplies a
// signing `pubKey` + a self-signed `proof`, we verify key ownership BEFORE spending the code,
// then — after redeem — hand (code, pubKey, podRef) to the injected `onIdentity` so the wiring
// binds the channel pseudonym → pubKey in the project roster. Redemption + binding are thus
// atomic: one code → one verified identity (anti-sybil). Backward-compatible (both optional).

import { verifyRegistration } from '../pod/signing.js';

/**
 * @param {object} args
 * @param {import('./cohort.js').InMemoryCohortRegistry} args.registry
 * @param {string} args.projectId
 * @param {string} args.code                       the activation code the participant entered
 * @param {string} args.recoveryHash               hash of the participant's client-generated recovery secret
 * @param {string} args.now                        ISO timestamp (caller-stamped)
 * @param {(ctx:{projectId:string,config?:object}) => Promise<{podRef:string}>} args.provisionPod  substrate
 * @param {object} [args.config]                    the project ProjectConfig, injected at runtime
 * @param {string} [args.pubKey]                    participant Ed25519 signing key (b64url) to register
 * @param {string} [args.proof]                     self-signature over (projectId, code, pubKey)
 * @param {(ctx:{projectId,code,pubKey,podRef,recoveryHash}) => Promise<void>|void} [args.onIdentity]
 * @returns {Promise<{ok:true, podRef:string} | {ok:false, reason:string}>}
 */
export async function activate({ registry, projectId, code, recoveryHash, now, provisionPod, config, pubKey, encPubKey, proof, onIdentity }) {
  // 1. validate the code first (cheap, before provisioning anything)
  const v = registry.validate(projectId, code, now);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!recoveryHash) return { ok: false, reason: 'missing recovery hash' };

  // 1b. if registering an identity, prove key ownership BEFORE spending the code
  if (pubKey || proof) {
    if (!verifyRegistration({ projectId, code, pubKey, encPubKey }, proof)) return { ok: false, reason: 'invalid identity proof' };
  }

  // 2. substrate: provision the pod + ACL + central container, inject the config.
  //    If this throws, the code is NOT spent (retry is possible).
  const { podRef } = await provisionPod({ projectId, config });

  // 3. redeem the code (single use) and record the amnesic activation.
  const record = registry.redeem(projectId, code, now, { recoveryHash, podRef });

  // 4. bind the verified identity to the project roster (atomic with redemption).
  if (pubKey && onIdentity) await onIdentity({ projectId, code, pubKey, encPubKey, podRef: record.podRef, recoveryHash });

  return { ok: true, podRef: record.podRef };
}

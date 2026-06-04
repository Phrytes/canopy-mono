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

/**
 * @param {object} args
 * @param {import('./cohort.js').InMemoryCohortRegistry} args.registry
 * @param {string} args.projectId
 * @param {string} args.code                       the activation code the participant entered
 * @param {string} args.recoveryHash               hash of the participant's client-generated recovery secret
 * @param {string} args.now                        ISO timestamp (caller-stamped)
 * @param {(ctx:{projectId:string,config?:object}) => Promise<{podRef:string}>} args.provisionPod  substrate
 * @param {object} [args.config]                    the project ProjectConfig, injected at runtime
 * @returns {Promise<{ok:true, podRef:string} | {ok:false, reason:string}>}
 */
export async function activate({ registry, projectId, code, recoveryHash, now, provisionPod, config }) {
  // 1. validate the code first (cheap, before provisioning anything)
  const v = registry.validate(projectId, code, now);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!recoveryHash) return { ok: false, reason: 'missing recovery hash' };

  // 2. substrate: provision the pod + ACL + central container, inject the config.
  //    If this throws, the code is NOT spent (retry is possible).
  const { podRef } = await provisionPod({ projectId, config });

  // 3. redeem the code (single use) and record the amnesic activation.
  const record = registry.redeem(projectId, code, now, { recoveryHash, podRef });
  return { ok: true, podRef: record.podRef };
}

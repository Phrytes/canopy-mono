// Aggregation placement (Phase 1) — WHERE the project private key is allowed to open
// contributions, made an explicit, ENFORCED per-project choice. Sealing is asymmetric, so the
// always-on writer and the platform storage hold only ciphertext; the one moment plaintext is
// assembled is aggregation, and this module decides on whose machine that may happen:
//
//   • 'host'       — the shared platform host decrypts (convenient, normal-trust: the platform
//                    sees plaintext transiently). DEFAULT, so existing deployments are unchanged.
//   • 'controller' — only the project team's OWN servers may decrypt. The platform never holds
//                    a key and only ever serves ciphertext; plaintext appears solely on the data
//                    controller's infrastructure (Phase 1 privacy posture).
//   • 'enclave'    — only an attested TEE may decrypt (Phase 2; not even the controller's host
//                    can read — see docs/security-model.md).
//
// Enforcement: a process declares its role via FP_RUNNER_ROLE. Building an opener (the only way
// to decrypt — see crypto-config.js) is REFUSED unless the runner is at least as private as the
// project requires. So a platform-host process literally cannot decrypt a 'controller' project;
// the choice is a mechanism, not a promise.

export const AGGREGATION_LOCATIONS = ['host', 'controller', 'enclave'];
const RANK = { host: 0, controller: 1, enclave: 2 };   // higher = more private

const envRole = () => (typeof process !== 'undefined' && process.env && process.env.FP_RUNNER_ROLE) || 'host';

/** The role of THIS process, from FP_RUNNER_ROLE (default 'host'). */
export function runnerRole() {
  const r = String(envRole()).toLowerCase();
  if (!(r in RANK)) throw new Error(`FP_RUNNER_ROLE must be one of ${AGGREGATION_LOCATIONS.join(' | ')} (got "${r}")`);
  return r;
}

/** The placement a project requires (default 'host'). */
export function requiredLocation(config) {
  return config?.aggregation?.location || 'host';
}

/**
 * Gate: throw unless this runner is allowed to decrypt for this project.
 * @param {object} config
 * @param {{ runner?: string }} [opts]  override the runner (tests); defaults to FP_RUNNER_ROLE
 * @returns {{ required:string, runner:string }}
 */
export function assertAggregationAllowed(config, { runner = runnerRole() } = {}) {
  const required = requiredLocation(config);
  if (!(runner in RANK)) throw new Error(`unknown runner role "${runner}"`);
  if (RANK[runner] < RANK[required]) {
    throw new Error(
      `aggregation placement: project "${config?.projectId ?? '?'}" requires decryption on "${required}" ` +
      `or stronger, but this runner is "${runner}". Run aggregation on the ${required}'s infrastructure ` +
      `(set FP_RUNNER_ROLE=${required}), or lower aggregation.location.`);
  }
  return { required, runner };
}

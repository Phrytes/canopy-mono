// TEE aggregation boundary (PR-4 / plan §5, the fix for security gap #6). Aggregation is the
// ONE moment many people's plaintext is assembled at once — nothing but a Trusted Execution
// Environment can protect it from a root-capable host. This module is that boundary: the
// project private key opens the contributions, signatures are verified, and the Task-2
// aggregate is computed ALL inside one function; only the aggregate (+ an attestation) leaves.
// The private key and the plaintext never escape its scope.
//
// In dev this runs in-process with a STUB attestation. In production the same body runs inside
// an attested enclave (e.g. the Privatemode TEE that already fronts the LLM route), `attest`
// returns a real remote-attestation quote, and the caller verifies that quote BEFORE trusting
// the aggregate. The shape here is what makes that swap a one-line change.

import { cryptoForProject } from '../pod/crypto-config.js';
import { ByoCentralPod } from '../pod/byo-central-pod.js';
import { runnerRole } from '../aggregation/placement.js';

/** Dev/Phase-1 attestation stub — honestly reports where plaintext was assembled. Only a
 *  runner role of 'enclave' (Phase 2) yields `verified:true`; 'host'/'controller' say plainly
 *  that the plaintext lived in that machine's ordinary RAM. Production replaces this with a real
 *  enclave quote the caller verifies. */
export function localAttestation() {
  const runner = runnerRole();
  return {
    kind: runner === 'enclave' ? 'enclave' : 'phase1-no-tee',
    runner, verified: runner === 'enclave',
    // The code measurement a caller pins via verifyAttestation (tee/attestation.js). The stub
    // reads FP_ENCLAVE_MEASUREMENT; a real enclave fills it from the SEV-SNP / Contrast report.
    measurement: runner === 'enclave'
      ? ((typeof process !== 'undefined' && process.env && process.env.FP_ENCLAVE_MEASUREMENT) || undefined)
      : undefined,
    note: runner === 'enclave'
      ? 'replace with a real remote-attestation quote the caller verifies'
      : `plaintext was assembled in the "${runner}" machine's ordinary RAM — confidential only at rest and from other parties, not from this host (Phase 2 = enclave)`,
    at: new Date().toISOString(),
  };
}

/**
 * @param {object} a
 * @param {object} a.config                 ProjectConfig
 * @param {string} a.projectPrivateKey      the team-unwrapped key — enters the boundary, never leaves
 * @param {object} [a.roster]               identity roster (verification); run with this ON for BYO
 * @param {() => Promise<Array>} a.readSealed  reads sealed+signed records {participant,contribution,sig,pubKey}
 * @param {(items:Array, config:object) => Promise<object>} a.aggregate  the Task-2 aggregator (runs in-enclave)
 * @param {() => object} [a.attest]
 * @returns {Promise<{ aggregate:object, attestation:object, contributionCount:number }>}
 */
export async function runSealedAggregation({ config, projectPrivateKey, roster, readSealed, aggregate, attest = localAttestation }) {
  if (typeof readSealed !== 'function') throw new Error('runSealedAggregation: readSealed() required');
  if (typeof aggregate !== 'function') throw new Error('runSealedAggregation: aggregate() required');

  // The opener + verifier are built HERE, behind the boundary, from a key that exists only in
  // this scope. cryptoForProject gives `open` only because we hold the private key.
  const { open, verify } = cryptoForProject({ config, projectPrivateKey, roster });

  const records = await readSealed();
  const pod = new ByoCentralPod({ open, verify });
  const byParticipant = new Map();
  for (const r of records) { if (!byParticipant.has(r.participant)) byParticipant.set(r.participant, []); byParticipant.get(r.participant).push(r); }
  for (const [participant, recs] of byParticipant) pod.addSource({ participant, read: async () => recs });

  const items = await pod.forAggregation();        // plaintext — never leaves this function
  const result = await aggregate(items, config);   // the aggregate is the ONLY data we return

  return { aggregate: result, attestation: attest(), contributionCount: items.length };
  // open / projectPrivateKey / records / items all go out of scope here — never returned, never logged.
}

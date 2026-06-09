// M7/M8 — attestation verification seam. The caller-side gate that closes placement.js's
// self-declared-role gap: when a project requires 'enclave', the runner's enclave claim must be
// PROVEN by a verified quote (optionally pinned to a code measurement), not just asserted via
// FP_RUNNER_ROLE. The real SEV-SNP/Contrast verifier swaps in behind the same shape.   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAttestation, assertEnclaveAttested, verifyGatewayAttestation } from '../src/tee/attestation.js';
import { runSealedAggregation } from '../src/tee/aggregate.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';

test('verifyAttestation: rejects missing / unverified, accepts verified, pins measurement', () => {
  assert.equal(verifyAttestation(null).ok, false);
  assert.equal(verifyAttestation({ kind: 'phase1-no-tee', runner: 'host', verified: false }).ok, false);
  assert.equal(verifyAttestation({ kind: 'enclave', runner: 'enclave', verified: true }).ok, true);
  // measurement pinning
  assert.equal(verifyAttestation({ verified: true, measurement: 'sha256:abc' }, { expectedMeasurement: 'sha256:abc' }).ok, true);
  assert.equal(verifyAttestation({ verified: true, measurement: 'sha256:xyz' }, { expectedMeasurement: 'sha256:abc' }).ok, false);
  assert.equal(verifyAttestation({ verified: true }, { expectedMeasurement: 'sha256:abc' }).ok, false); // none present
});

test('assertEnclaveAttested: no-op for host/controller, gates for enclave', () => {
  const host = validateProjectConfig({ projectId: 'a', llm: { route: 'local', model: 'm' }, aggregation: { k: 1, location: 'host' } });
  assert.deepEqual(assertEnclaveAttested(null, host), { ok: true, skipped: true });   // nothing to attest

  const enclave = validateProjectConfig({ projectId: 'a', llm: { route: 'local', model: 'm' }, aggregation: { k: 1, location: 'enclave', attestation: { expectedMeasurement: 'sha256:abc' } } });
  assert.throws(() => assertEnclaveAttested({ verified: false, runner: 'host' }, enclave), /verified attestation/);
  assert.throws(() => assertEnclaveAttested({ verified: true, measurement: 'sha256:WRONG' }, enclave), /measurement mismatch/);
  assert.doesNotThrow(() => assertEnclaveAttested({ verified: true, measurement: 'sha256:abc' }, enclave));
});

test('verifyGatewayAttestation (M7): pins the gateway measurement', () => {
  assert.equal(verifyGatewayAttestation({ verified: false }, { expectedMeasurement: 'm1' }).ok, false);
  assert.equal(verifyGatewayAttestation({ verified: true, measurement: 'm1' }, { expectedMeasurement: 'm1' }).ok, true);
});

test('M8 end-to-end: runSealedAggregation attestation is gated by the runner role', async (t) => {
  const key = generateProjectKeypair();
  const config = validateProjectConfig({
    projectId: 'tee', llm: { route: 'local', model: 'm' },
    aggregation: { k: 1, location: 'enclave', attestation: { expectedMeasurement: 'sha256:abc' } },
    privacy: { seal: true, keygen: 'host', projectPublicKey: key.publicKey },
  });
  const prevRole = process.env.FP_RUNNER_ROLE, prevMeas = process.env.FP_ENCLAVE_MEASUREMENT;
  t.after(() => {
    if (prevRole === undefined) delete process.env.FP_RUNNER_ROLE; else process.env.FP_RUNNER_ROLE = prevRole;
    if (prevMeas === undefined) delete process.env.FP_ENCLAVE_MEASUREMENT; else process.env.FP_ENCLAVE_MEASUREMENT = prevMeas;
  });
  const run = () => runSealedAggregation({ config, projectPrivateKey: key.privateKey, readSealed: async () => [], aggregate: async () => ({ statistical: [] }) });

  // placement.js already blocks a 'host' runner from an 'enclave' project (Phase-1 gate):
  process.env.FP_RUNNER_ROLE = 'host';
  await assert.rejects(run(), /requires decryption on "enclave"/);

  // M8's ADDED teeth: a runner that self-declares 'enclave' (so it passes placement) but runs the
  // WRONG code has no pinned measurement → the attestation gate still refuses. (In production the
  // `verified` flag itself comes from real SEV-SNP/Contrast quote verification, not a self-set role.)
  process.env.FP_RUNNER_ROLE = 'enclave';
  delete process.env.FP_ENCLAVE_MEASUREMENT;
  const r1 = await run();
  assert.equal(r1.attestation.measurement, undefined);
  assert.throws(() => assertEnclaveAttested(r1.attestation, config), /measurement mismatch/);

  // the genuine enclave running the MEASURED code → measurement matches the pin → gate passes
  process.env.FP_ENCLAVE_MEASUREMENT = 'sha256:abc';
  const r2 = await run();
  assert.equal(r2.attestation.measurement, 'sha256:abc');
  assert.doesNotThrow(() => assertEnclaveAttested(r2.attestation, config));
});

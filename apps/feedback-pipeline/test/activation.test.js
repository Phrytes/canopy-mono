// Tests for the cohort-code lifecycle + activation orchestration (Phase 3 groundwork).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCohortRegistry, makeCode, codeSignatureValid, recoveryHashOf } from '../src/activation/cohort.js';
import { activate } from '../src/activation/activate.js';

const SPEC = { projectId: 'proj-1', expiresAt: '2026-12-31T00:00:00Z', ceiling: 2 };
const SECRET = 'project-signing-secret';
const NOW = '2026-06-04T00:00:00Z';

test('codes are HMAC-signed and verify only for their project + secret', () => {
  const code = makeCode('proj-1', SECRET);
  assert.equal(codeSignatureValid('proj-1', code, SECRET), true);
  assert.equal(codeSignatureValid('proj-1', code, 'wrong-secret'), false);
  assert.equal(codeSignatureValid('other-proj', code, SECRET), false);
  assert.equal(codeSignatureValid('proj-1', 'garbage', SECRET), false);
});

test('validate enforces single-use, expiry and ceiling', () => {
  const reg = new InMemoryCohortRegistry();
  reg.registerProject(SPEC, SECRET);
  const [c1, c2, c3] = reg.generateCodes('proj-1', 3);

  assert.deepEqual(reg.validate('proj-1', c1, NOW), { ok: true });
  // single-use
  reg.redeem('proj-1', c1, NOW, { recoveryHash: 'h1', podRef: 'pod://1' });
  assert.equal(reg.validate('proj-1', c1, NOW).reason, 'code already used');
  // expiry
  assert.equal(reg.validate('proj-1', c2, '2027-01-01T00:00:00Z').reason, 'cohort expired');
  // ceiling (1 used; ceiling 2 → after a 2nd, the 3rd is refused)
  reg.redeem('proj-1', c2, NOW, { recoveryHash: 'h2', podRef: 'pod://2' });
  assert.equal(reg.validate('proj-1', c3, NOW).reason, 'cohort full');
  assert.equal(reg.activationCount('proj-1'), 2);
});

test('amnesic: redeem stores only recovery-hash ↔ pod-ref; claim by recovery preimage', () => {
  const reg = new InMemoryCohortRegistry();
  reg.registerProject(SPEC, SECRET);
  const [c1] = reg.generateCodes('proj-1', 1);
  const recovery = 'participant-recovery-secret';
  const record = reg.redeem('proj-1', c1, NOW, { recoveryHash: recoveryHashOf(recovery), podRef: 'pod://abc' });
  assert.deepEqual(Object.keys(record).sort(), ['podRef', 'recoveryHash']);   // NO identity
  assert.equal(reg.claimByRecovery('proj-1', recovery)?.podRef, 'pod://abc'); // present preimage → pod
  assert.equal(reg.claimByRecovery('proj-1', 'wrong'), null);
});

test('registry survives JSON round-trip (the file-backed CLI store)', () => {
  const reg = new InMemoryCohortRegistry();
  reg.registerProject(SPEC, SECRET);
  const [c1, c2] = reg.generateCodes('proj-1', 2);
  reg.redeem('proj-1', c1, NOW, { recoveryHash: 'h1', podRef: 'pod://1' });

  const reloaded = InMemoryCohortRegistry.fromJSON(JSON.parse(JSON.stringify(reg.toJSON())));
  assert.equal(reloaded.activationCount('proj-1'), 1);
  assert.equal(reloaded.validate('proj-1', c1, NOW).reason, 'code already used'); // spent survived
  assert.deepEqual(reloaded.validate('proj-1', c2, NOW), { ok: true });           // unspent valid
  assert.equal(reloaded.getSpec('proj-1').ceiling, 2);
});

test('activate() orchestration: validate → provision (substrate stub) → redeem', async () => {
  const reg = new InMemoryCohortRegistry();
  reg.registerProject(SPEC, SECRET);
  const [code] = reg.generateCodes('proj-1', 1);
  let provisioned = null;
  const provisionPod = async ({ projectId, config }) => { provisioned = { projectId, config }; return { podRef: 'pod://new' }; };

  const ok = await activate({ registry: reg, projectId: 'proj-1', code, recoveryHash: 'rh', now: NOW, provisionPod, config: { projectId: 'proj-1' } });
  assert.deepEqual(ok, { ok: true, podRef: 'pod://new' });
  assert.equal(provisioned.projectId, 'proj-1');
  assert.equal(reg.activationCount('proj-1'), 1);

  // a bad code is refused BEFORE provisioning
  let calls = 0;
  const res = await activate({ registry: reg, projectId: 'proj-1', code: 'bad', recoveryHash: 'rh', now: NOW, provisionPod: async () => { calls++; return { podRef: 'x' }; } });
  assert.equal(res.ok, false);
  assert.equal(calls, 0, 'no provisioning on an invalid code');
});

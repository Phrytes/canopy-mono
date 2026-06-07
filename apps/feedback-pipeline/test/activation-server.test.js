// Activation service — the HTTP front over activate() + provisionPod. Proves the outcome
// mapping (200 / 400 / 409 / 502), that a failed provision does NOT spend the code, and a
// real HTTP round trip + persistence hook.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCohortRegistry } from '../src/activation/cohort.js';
import { handleActivate, createActivationServer } from '../src/activation/server.js';

const NOW = '2026-06-05T00:00:00Z';
const now = () => NOW;
const okProvision = async ({ projectId }) => ({ podRef: `pod://test/${projectId}/c1` });

function freshRegistry() {
  const reg = new InMemoryCohortRegistry();
  reg.registerProject({ projectId: 'p', expiresAt: '2026-12-31T00:00:00Z', ceiling: 5 }, 'secret');
  const [code] = reg.generateCodes('p', 1);
  return { reg, code };
}

test('happy path → 200 + podRef, code spent', async () => {
  const { reg, code } = freshRegistry();
  const out = await handleActivate({ body: { projectId: 'p', code, recoveryHash: 'rh', webId: 'https://pods.example/p#me' }, registry: reg, provisionPod: okProvision, now });
  assert.equal(out.status, 200);
  assert.match(out.json.podRef, /^pod:\/\/test\/p\//);
  // code is now spent → a second activation is rejected
  const again = await handleActivate({ body: { projectId: 'p', code, recoveryHash: 'rh2', webId: 'https://pods.example/p2#me' }, registry: reg, provisionPod: okProvision, now });
  assert.equal(again.status, 409);
});

test('missing fields → 400', async () => {
  const { reg } = freshRegistry();
  const out = await handleActivate({ body: { projectId: 'p' }, registry: reg, provisionPod: okProvision, now });
  assert.equal(out.status, 400);
});

test('invalid code → 409', async () => {
  const { reg } = freshRegistry();
  const out = await handleActivate({ body: { projectId: 'p', code: 'nope-deadbeef', recoveryHash: 'rh', webId: 'https://pods.example/p#me' }, registry: reg, provisionPod: okProvision, now });
  assert.equal(out.status, 409);
});

test('provision failure → 502 and the code is NOT spent (retryable)', async () => {
  const { reg, code } = freshRegistry();
  const boom = async () => { throw new Error('CSS unreachable'); };
  const out = await handleActivate({ body: { projectId: 'p', code, recoveryHash: 'rh', webId: 'https://pods.example/p#me' }, registry: reg, provisionPod: boom, now });
  assert.equal(out.status, 502);
  // retry with the same code now succeeds (it was never redeemed)
  const retry = await handleActivate({ body: { projectId: 'p', code, recoveryHash: 'rh', webId: 'https://pods.example/p#me' }, registry: reg, provisionPod: okProvision, now });
  assert.equal(retry.status, 200);
});

test('HTTP round trip + persistence hook', async () => {
  const { reg, code } = freshRegistry();
  let persisted = 0;
  const server = createActivationServer({ registry: reg, provisionPod: okProvision, now, onRedeem: () => { persisted++; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const res = await fetch(`${base}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p', code, recoveryHash: 'rh', webId: 'https://pods.example/p#me' }) });
    assert.equal(res.status, 200);
    assert.match((await res.json()).podRef, /pod:\/\/test\/p\//);
    assert.equal(persisted, 1);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

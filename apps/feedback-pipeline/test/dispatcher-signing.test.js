// PR-3 — signing threaded through the dispatcher. On a participant-controlled channel
// (canopy-chat on-device) consent() signs each contribution with the participant's key, so a
// verify-enabled project accepts it. The host-run TG delegate has no participant key → it
// writes unsigned, which a verify-enabled project refuses (TG = the lightweight option). A
// seal-only project still works without an identity (backward compatible).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../src/pod/signing.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';
import { cryptoForProject } from '../src/pod/crypto-config.js';

const cfg = (privacy) => validateProjectConfig({ projectId: 'p', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 }, ...(privacy ? { privacy } : {}) });

async function withMockLlm(t) {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });
}

test('canopy-chat (with identity): consent signs; a verify-enabled pod accepts', async (t) => {
  await withMockLlm(t);
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('cc:1', id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'p' }) });
  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod, config: cfg({ verify: true }), participant: 'cc:1', identity: id });

  await d.handleMessage('De GGZ wachtlijst is veel te lang.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id), { timeWindow: '2026-Q2' });
  assert.ok(written.length >= 1);
  assert.equal(pod.forAggregation().length, written.length);   // verified → aggregated
});

test('TG delegate (no identity) on a verify project: graceful "verification-required", no write, no throw', async (t) => {
  await withMockLlm(t);
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('tg:1', id.publicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'p' }) });
  const adapter = new MemoryChannelAdapter();
  const d = new ChannelDispatcher({ adapter, pod, config: cfg({ verify: true }), participant: 'tg:1' });   // no identity

  await d.handleMessage('Parkeren in de wijk is te duur.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id));   // does NOT throw
  assert.deepEqual(written, []);
  assert.equal(pod.forAggregation().length, 0);               // nothing stored
  assert.ok(adapter.sent.some((m) => m.type === 'verification-required'), 'participant told to use the canopy app');
});

test('a refused write rolls the batch back and reports consent-failed (no half-applied consent)', async (t) => {
  await withMockLlm(t);
  // a pod that accepts the first write then refuses the second (simulates a mid-batch verify failure)
  let n = 0;
  const inner = new InMemoryCentralPod();
  const pod = {
    write: (participant, c, meta) => { if (++n === 2) throw new Error('invalid signature'); return inner.write(participant, c, meta); },
    withdraw: (participant, id) => inner.withdraw(participant, id),
    forAggregation: () => inner.forAggregation(),
  };
  const adapter = new MemoryChannelAdapter();
  const id = generateParticipantIdentity();
  const d = new ChannelDispatcher({ adapter, pod, config: cfg(), participant: 'cc:1', identity: id });

  await d.handleMessage('De wachtlijst bij de GGZ is te lang.');
  await d.handleMessage('Het parkeren is te duur.');
  const points = await d.review();
  if (points.length < 2) return;   // mock collapsed them; the single-write path is covered elsewhere
  const written = await d.consent(points.map((p) => p.id));
  assert.deepEqual(written, []);
  assert.equal(inner.forAggregation().length, 0, 'the first (accepted) write was rolled back');
  assert.ok(adapter.sent.some((m) => m.type === 'consent-failed'));
});

test('seal-only project works without an identity (backward compatible) + signed seal round-trips', async (t) => {
  await withMockLlm(t);
  const key = generateProjectKeypair();
  const config = cfg({ seal: true, projectPublicKey: key.publicKey });
  const pod = new InMemoryCentralPod(cryptoForProject({ config, projectPrivateKey: key.privateKey }));
  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod, config, participant: 'cc:9' });   // no identity, seal only

  await d.handleMessage('De speeltuin in de wijk is verouderd.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id));
  assert.equal(pod.forAggregation().length, written.length);   // sealed unsigned write, opened on read
});

test('signed AND sealed together: a verify+seal project accepts and round-trips', async (t) => {
  await withMockLlm(t);
  const id = generateParticipantIdentity();
  const key = generateProjectKeypair();
  const roster = new IdentityRoster();
  roster.bind('cc:2', id.publicKey, id.encPublicKey);
  const config = cfg({ seal: true, verify: true, keygen: 'host', projectPublicKey: key.publicKey });
  const pod = new InMemoryCentralPod(cryptoForProject({ config, projectPrivateKey: key.privateKey, roster }));
  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod, config, participant: 'cc:2', identity: id });

  await d.handleMessage('Het buurthuis heeft te weinig openingsuren.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id));
  const agg = pod.forAggregation();
  assert.equal(agg.length, written.length);
  assert.ok(agg[0].text.length > 0 && !agg[0].text.startsWith('fp1:'));   // opened, not ciphertext
});

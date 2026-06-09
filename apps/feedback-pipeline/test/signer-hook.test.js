// M1.3 — the dispatcher signs consent with whatever identity it's given: either a
// feedback-pipeline keypair OR a vault AgentIdentity (sign(bytes) + pubKey). Proves the
// canopy-chat vault key works through the dispatcher → a verify pod accepts the write.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockLlm } from './helpers/mock-llm.js';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { contributionMeta, IdentityRoster, makeContributionVerifier, generateParticipantIdentity } from '../src/pod/signing.js';
import { AgentIdentity } from '../../../packages/core/src/identity/AgentIdentity.js';

const projectId = 'm13';
const config = () => validateProjectConfig({ projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 }, privacy: { verify: true } });

test('contributionMeta accepts both a keypair and an AgentIdentity-style signer', () => {
  const c = { id: 'x:1', text: 'hi' };
  const kp = generateParticipantIdentity();
  const m1 = contributionMeta(kp, { projectId, participant: 'x', contribution: c });
  assert.ok(m1.sig && m1.pubKey === kp.publicKey);

  const agent = new AgentIdentity({ seed: new Uint8Array(randomBytes(32)), vault: {} });
  const m2 = contributionMeta(agent, { projectId, participant: 'x', contribution: c });
  assert.ok(m2.sig && m2.pubKey === agent.pubKey);

  assert.deepEqual(contributionMeta(null, { projectId, participant: 'x', contribution: c }), {});
});

test('dispatcher signs with a vault AgentIdentity → a verify pod accepts the consent write', async (t) => {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });

  // a participant whose key lives in the canopy-chat vault as an AgentIdentity
  const agent = new AgentIdentity({ seed: new Uint8Array(randomBytes(32)), vault: {} });
  const roster = new IdentityRoster();
  roster.bind('cc:a', agent.pubKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId }) });

  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod, config: config(), participant: 'cc:a', identity: agent });
  await d.handleMessage('De GGZ-wachtlijst is veel te lang.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id));

  assert.ok(written.length >= 1);
  assert.equal(pod.forAggregation().length, written.length);   // AgentIdentity-signed → verified → aggregated
});

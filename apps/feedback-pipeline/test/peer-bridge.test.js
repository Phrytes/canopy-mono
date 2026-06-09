// M5 — PeerBridge: the external bot over the peer transport. Mirrors the InternalBusBridge
// journey but across a (faked) sa.peer link. The external bot is unsigned, so a verify-enabled
// project refuses its writes GRACEFULLY (verification-required); a non-verify project accepts.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { PeerBridge } from '../src/channel/peer-bridge.js';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { IdentityRoster, generateParticipantIdentity, makeContributionVerifier } from '../src/pod/signing.js';

// a tiny in-process stand-in for sa.peer: sendTo(addr,payload) delivers to addr's handler
function fakePeerMesh() {
  const handlers = new Map();
  return {
    // await the receiver's handler so tests can deterministically await full turn processing
    peerFor: (self) => ({ sendTo: async (to, payload) => { await Promise.resolve(); return handlers.get(to)?.({ from: self, payload }); } }),
    register: (addr, fn) => handlers.set(addr, fn),
  };
}

const config = (privacy) => validateProjectConfig({
  projectId: 'peer', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  ...(privacy ? { privacy } : {}),
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});

function withMockLlm(t) {
  const prev = process.env.FP_LLM_BASEURL;
  return startMockLlm().then((mock) => {
    process.env.FP_LLM_BASEURL = mock.url;
    t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });
    return mock;
  });
}

test('PeerBridge requires a peer with sendTo()', () => {
  assert.throws(() => new PeerBridge({}), /peer with sendTo/);
  assert.equal(new PeerBridge({ peer: { sendTo: async () => {} } }).id, 'peer');
});

test('external bot over a peer link: full journey, unsigned write accepted (no verify)', async (t) => {
  await withMockLlm(t);
  const mesh = fakePeerMesh();
  const pod = new InMemoryCentralPod();
  const bridge = new PeerBridge({ peer: mesh.peerFor('bot') });
  const bot = new CanopyChatBot({ bridge, pod, config: config(), participantFor: (c) => c });   // no identityFor → unsigned
  await bot.start();
  mesh.register('bot', bridge.onPeerMessage);

  const replies = [];
  mesh.register('alice', (env) => { if (env.payload?.subtype === 'fp-reply') replies.push(env.payload); });
  const alice = mesh.peerFor('alice');
  const send = (text) => alice.sendTo('bot', { subtype: 'fp-msg', text, messageId: `${Date.now()}` });

  await send('De wachtlijst bij de GGZ is al maanden veel te lang.');
  await send('oké volgens mij ben ik wel klaar zo');
  await send('ja stuur ze allemaal maar door');

  assert.equal(pod.list().length, 1);
  assert.equal(pod.list()[0].participant, 'alice');
  assert.ok(replies.some((r) => /opgeslagen/.test(r.text || '')), 'a confirmation came back over the peer link');
});

test('external bot under privacy.verify: unsigned write refused gracefully (verification-required)', async (t) => {
  await withMockLlm(t);
  const mesh = fakePeerMesh();
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('bob', id.publicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'peer' }) });
  const bridge = new PeerBridge({ peer: mesh.peerFor('bot') });
  const bot = new CanopyChatBot({ bridge, pod, config: config({ verify: true }), participantFor: (c) => c });   // unsigned
  await bot.start();
  mesh.register('bot', bridge.onPeerMessage);
  const replies = [];
  mesh.register('bob', (env) => replies.push(env.payload));
  const bob = mesh.peerFor('bob');

  await bob.sendTo('bot', { subtype: 'fp-msg', text: 'parkeren in de wijk te duur', messageId: '1' });
  await bob.sendTo('bot', { subtype: 'fp-msg', text: 'oké volgens mij ben ik wel klaar zo', messageId: '2' });
  await bob.sendTo('bot', { subtype: 'fp-msg', text: 'ja stuur ze allemaal maar door', messageId: '3' });

  assert.equal(pod.forAggregation().length, 0, 'nothing stored — unsigned write to a verify pod');
  assert.ok(replies.some((r) => /geverifieerde identiteit|verified identity|canopy/i.test(r.text || '')), 'told to use the canopy app');
});

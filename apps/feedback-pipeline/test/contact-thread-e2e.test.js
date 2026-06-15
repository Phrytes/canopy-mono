// #11 — END-TO-END: the REAL canopy-chat contact-thread channel ↔ the feedback bot.
//
// Proves the live reply round-trip the platform Contacten DM thread relies on: a
// canopy-chat CLIENT sends a turn over the real `contactThreadChannel` (the generic
// `contact-msg`), the feedback bot (`startExternalCanopyBot` → PeerBridge +
// CanopyChatBot + the full review/intent/redact/pod pipeline) processes it, replies
// `contact-reply` with the thread id echoed, and the client's real `makePeerRouter`
// delivers it back into the thread. An in-process mesh stands in for sa.peer so the
// test is deterministic + CI-able (no NKN, no browser) — but BOTH the platform
// channel and the feedback bot are the REAL modules; only the transport is faked.
//
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { startExternalCanopyBot } from '../scripts/canopy-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';

// The PLATFORM channel + peer router (apps/canopy-chat/src — these become published
// `@canopy/*` exports after the P7 extraction; the relative import documents the seam
// the feedback repo builds against).
import { createContactThreadChannel } from '../../canopy-chat/src/v2/contactThreadChannel.js';
import { makePeerRouter } from '../../canopy-chat/src/core/handlers/peerRouter.js';

// A tiny in-process stand-in for sa.peer: sendTo(addr,payload) delivers to addr's
// handler and AWAITS it, so a turn's full async pipeline settles before we assert.
function fakePeerMesh() {
  const handlers = new Map();
  return {
    peerFor: (self) => ({ sendTo: async (to, payload) => { await Promise.resolve(); return handlers.get(to)?.({ from: self, payload }); } }),
    register: (addr, fn) => handlers.set(addr, fn),
  };
}

function withMockLlm(t) {
  const prev = process.env.FP_LLM_BASEURL;
  return startMockLlm().then((mock) => {
    process.env.FP_LLM_BASEURL = mock.url;
    t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });
    return mock;
  });
}

const projectConfig = () => validateProjectConfig({
  projectId: 'e2e', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});

test('END-TO-END: canopy-chat contact thread ↔ feedback bot — full journey + reply round-trip', async (t) => {
  await withMockLlm(t);
  const mesh = fakePeerMesh();
  const pod = new InMemoryCentralPod();   // no verify → unsigned writes accepted

  // The feedback bot (external / unsigned), reachable at peer address 'bot'.
  const { bridge, stop } = await startExternalCanopyBot({
    peer: mesh.peerFor('bot'), pod, config: projectConfig(), participantFor: (c) => c,
  });
  t.after(() => stop());
  mesh.register('bot', bridge.onPeerMessage);

  // The canopy-chat CLIENT at 'client': the REAL channel for sending + the REAL peer
  // router for receiving the bot's replies into the thread.
  const channel = createContactThreadChannel({
    sendToPeer: (addr, payload) => mesh.peerFor('client').sendTo(addr, payload),
  });
  const replies = [];
  mesh.register('client', makePeerRouter({
    handlers: { [channel.subtypes.in]: channel.replyHandler((r) => replies.push(r)) },
  }));

  // Drive a full feedback journey from the thread (awaiting each turn's pipeline).
  const send = async (text) => { const { sent } = channel.sendTurn({ peerAddr: 'bot', threadId: 't-1', text }); await sent; };
  await send('De wachtlijst bij de GGZ is al maanden veel te lang.');
  await send('oké volgens mij ben ik wel klaar zo');
  await send('ja stuur ze allemaal maar door');

  // The bot's confirmations came back over contact-reply, INTO the same thread.
  assert.ok(replies.length > 0, 'the client received bot replies over contact-reply');
  assert.ok(replies.every((r) => r.threadId === 't-1'), 'each reply carries the thread id back');
  assert.ok(
    replies.some((r) => /opgeslagen|doorgestuurd|stored|sent/i.test(r.text || '')),
    'a confirmation came back over the peer link',
  );
  // The full pipeline ran end-to-end: the contribution landed on the pod.
  assert.equal(pod.list().length, 1);
  assert.equal(pod.list()[0].participant, 'client');
});

test('END-TO-END: under privacy.verify, an unsigned external bot refuses gracefully into the thread', async (t) => {
  await withMockLlm(t);
  const mesh = fakePeerMesh();
  // A verify pod that only accepts signed writes — the external bot has no key.
  const { IdentityRoster, generateParticipantIdentity, makeContributionVerifier } = await import('../src/pod/signing.js');
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('client', id.publicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'e2e' }) });

  const config = validateProjectConfig({
    projectId: 'e2e', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
    privacy: { verify: true }, signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  });
  const { bridge, stop } = await startExternalCanopyBot({ peer: mesh.peerFor('bot'), pod, config, participantFor: (c) => c });
  t.after(() => stop());
  mesh.register('bot', bridge.onPeerMessage);

  const channel = createContactThreadChannel({ sendToPeer: (addr, payload) => mesh.peerFor('client').sendTo(addr, payload) });
  const replies = [];
  mesh.register('client', makePeerRouter({ handlers: { [channel.subtypes.in]: channel.replyHandler((r) => replies.push(r)) } }));

  const send = async (text) => { const { sent } = channel.sendTurn({ peerAddr: 'bot', threadId: 't-2', text }); await sent; };
  await send('parkeren in de wijk is veel te duur');
  await send('oké volgens mij ben ik wel klaar zo');
  await send('ja stuur ze allemaal maar door');

  assert.equal(pod.forAggregation().length, 0, 'nothing stored — unsigned write to a verify pod');
  assert.ok(replies.length > 0 && replies.every((r) => r.threadId === 't-2'), 'the refusal came back into the thread');
  assert.ok(
    replies.some((r) => /geverifieerde identiteit|verified identity|canopy/i.test(r.text || '')),
    'told to use a verified identity / the canopy app',
  );
});

// M1 — InternalBusBridge: the production in-process bridge. The bot is co-hosted with the
// participant on ONE real @canopy/core InternalBus (no network); the full canopy-chat journey
// runs over it and the consent write is SIGNED (accepted by a verify-enabled pod). Proves the
// bridge is a drop-in MessagingBridge for the real bus, not a test-only fake.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InternalBus } from '@canopy/core';
import { InternalBusBridge, connectFeedbackParticipant } from '../src/channel/internal-bus-bridge.js';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../src/pod/signing.js';

const projectId = 'cc';
const config = () => validateProjectConfig({
  projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  privacy: { verify: true },
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

test('InternalBusBridge requires a shared bus', () => {
  assert.throws(() => new InternalBusBridge({}), /shared InternalBus/);
  assert.equal(new InternalBusBridge({ bus: new InternalBus() }).id, 'internal-bus');
});

test('full journey over a real InternalBus → SIGNED consent write, replies over the bus', async (t) => {
  await withMockLlm(t);

  // a verify-enabled pod + a registered participant identity
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('anils', id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId }) });

  // co-host the bot on a shared bus; the participant connects to the SAME bus
  const bus = new InternalBus();
  const bridge = new InternalBusBridge({ bus, address: 'fp-bot' });
  const bot = new CanopyChatBot({ bridge, pod, config: config(), participantFor: (c) => c, identityFor: () => id });
  await bot.start();
  const me = connectFeedbackParticipant(bus, { botAddress: 'fp-bot', chatId: 'anils' });

  await me.send('De wachtlijst bij de GGZ is al maanden veel te lang.');   // received
  assert.match(me.replies.at(-1).text, /Ontvangen/);

  await me.send('oké volgens mij ben ik wel klaar zo');                    // review
  assert.ok(me.replies.at(-1).buttons?.some((b) => b.id === 'fp:consent:all'), 'review shown over the bus');

  await me.send('ja stuur ze allemaal maar door');                        // consent → signed write
  assert.match(me.replies.at(-1).text, /opgeslagen/);

  // the contribution is SIGNED — a verify-only pod returns it from forAggregation
  const agg = pod.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].user, 'anils');
  assert.equal(bridge.id, 'internal-bus');   // in-process, never a network transport
  me.close();
});

test('property-layer: a charter consent data-turn rides the consented contribution', async (t) => {
  await withMockLlm(t);
  const pod = new InMemoryCentralPod();                       // no verify → forAggregation returns all
  const cfg = validateProjectConfig({ projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 } });
  const bus = new InternalBus();
  const bot = new CanopyChatBot({ bridge: new InternalBusBridge({ bus, address: 'fp-bot' }), pod, config: cfg, participantFor: (c) => c });
  await bot.start();
  const me = connectFeedbackParticipant(bus, { botAddress: 'fp-bot', chatId: 'anils' });

  await me.send('De wachtlijst bij de GGZ is al maanden veel te lang.');
  const repliesBefore = me.replies.length;
  // hand off the participant's charter consent as a STRUCTURED data turn (no text) — silent, no reply bubble
  await me.send('', { data: { charter: { attributes: { place: 'Groningen' }, charterHash: 'ch-abc' } } });
  assert.equal(me.replies.length, repliesBefore, 'the disclosure hand-off emits no bubble');

  await me.send('oké volgens mij ben ik wel klaar zo');       // review
  await me.send('ja stuur ze allemaal maar door');            // consent → write

  const agg = pod.forAggregation();
  assert.equal(agg.length, 1);
  assert.deepEqual(agg[0].attributes, { place: 'Groningen' });   // the disclosed coarse attr rode the contribution
  assert.equal(agg[0].charterHash, 'ch-abc');
  me.close();
});

test('property-layer: back-compat — no charter turn → the contribution carries no attributes', async (t) => {
  await withMockLlm(t);
  const pod = new InMemoryCentralPod();
  const cfg = validateProjectConfig({ projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 } });
  const bus = new InternalBus();
  const bot = new CanopyChatBot({ bridge: new InternalBusBridge({ bus, address: 'fp-bot' }), pod, config: cfg, participantFor: (c) => c });
  await bot.start();
  const me = connectFeedbackParticipant(bus, { botAddress: 'fp-bot', chatId: 'anils' });

  await me.send('De wachtlijst bij de GGZ is al maanden veel te lang.');
  await me.send('oké volgens mij ben ik wel klaar zo');
  await me.send('ja stuur ze allemaal maar door');

  const agg = pod.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].attributes, undefined);
  assert.equal(agg[0].charterHash, undefined);
  me.close();
});

test('two participants on one bus stay isolated', async (t) => {
  await withMockLlm(t);
  const pod = new InMemoryCentralPod();
  const bus = new InternalBus();
  const bot = new CanopyChatBot({ bridge: new InternalBusBridge({ bus, address: 'fp-bot' }), pod, config: config(), participantFor: (c) => c });
  await bot.start();
  const a = connectFeedbackParticipant(bus, { chatId: 'a' });
  const b = connectFeedbackParticipant(bus, { chatId: 'b' });

  await a.send('GGZ wachtlijst veel te lang');
  await b.send('parkeren in de wijk te duur');
  // each only hears its own replies
  assert.ok(a.replies.length >= 1 && b.replies.length >= 1);
  assert.ok(a.replies.every((r) => r.chatId === 'a'));
  assert.ok(b.replies.every((r) => r.chatId === 'b'));
  a.close(); b.close();
});

// Verify-summary loop through the CanopyChatBot mount — poll → bubble → tap [verify] → central.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import * as signing from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';
import { InMemoryRoundControl, openVerificationRound } from '../src/verify/round-control.js';

function mockBridge() {
  let handler = null;
  const sent = [];
  return {
    onMessage(fn) { handler = fn; },
    async sendReply(r) { sent.push(r); },
    async start() {},
    async incoming(chatId, text) { await handler({ chatId: String(chatId), text, messageId: 'm' }); },
    sent,
  };
}

const mockSummarise = async ({ round }) => ({
  projectId: 'demo', round, summary: `summary r${round}`, points: [{ id: 'alice:p1', text: 'raw one' }],
  curatedFrom: ['alice:p1'], generatedAt: 'now',
});

test('canopy-chat mount: poll opens the verify bubble; tap [verify] → central; raw stays own', async () => {
  const id = signing.generateParticipantIdentity();
  const roster = new signing.IdentityRoster();
  roster.bind('alice', id.publicKey, id.encPublicKey);
  const verify = signing.makeContributionVerifier({ roster, projectId: 'demo' });
  const ownPod = new InMemoryCentralPod({ verify });
  const central = new InMemoryCentralPod({ verify });
  const control = new InMemoryRoundControl();
  const config = validateProjectConfig({
    projectId: 'demo', llm: { route: 'local', model: 'mock' },
    aggregation: { k: 1 }, privacy: { verify: true },
    signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  });
  const bridge = mockBridge();
  const bot = new CanopyChatBot({ bridge, pod: ownPod, centralPod: central, controlStore: control, config, participantFor: () => 'alice', identityFor: () => id });
  await bot.start();

  // Stage 1 — alice's RAW → her OWN pod.
  for (const [i, text] of ['raw one', 'raw two'].entries()) {
    const c = buildContribution({ id: `alice:p${i + 1}`, text }, { lang: 'nl' });
    await ownPod.write('alice', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'alice', contribution: c }));
  }

  // Stage 2 — lead opens a round → the bot poll opens the verify bubble (rendered via the bridge).
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, openedBy: 'lead' });
  await bot.pollVerification('chat-1', { summarise: mockSummarise });
  const bubble = bridge.sent.find((r) => /summary r1/.test(r.text || '') && (r.buttons || []).some((b) => b.id === 'fp:verify'));
  assert.ok(bubble, 'a verify-summary bubble with a [verify] button was rendered to the chat');

  // the participant taps [Approve & send] → the verified summary lands on central; raw stays own.
  await bridge.incoming('chat-1', 'fp:verify');
  assert.equal(central.list().length, 1, 'verified summary on central');
  assert.ok(central.list()[0].contribution.themeTags.includes('verified-summary'));
  assert.equal(ownPod.list().length, 2, 'raw stayed in the own pod');
});

test('canopy-chat mount: without centralPod/controlStore the poll is a no-op (legacy single-pod)', async () => {
  const bridge = mockBridge();
  const config = validateProjectConfig({ projectId: 'demo', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 } });
  const bot = new CanopyChatBot({ bridge, pod: new InMemoryCentralPod(), config });
  await bot.start();
  assert.equal(await bot.pollVerification('chat-1'), null);
});

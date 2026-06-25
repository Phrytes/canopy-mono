// Dispatcher verify-turn (Stage 2 of docs/DESIGN-verify-summary-loop.md) — deterministic (mock summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import * as signing from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';

function setup() {
  const id = signing.generateParticipantIdentity();
  const roster = new signing.IdentityRoster();
  roster.bind('p-1', id.publicKey, id.encPublicKey);
  const verify = signing.makeContributionVerifier({ roster, projectId: 'demo' });
  const ownPod = new InMemoryCentralPod({ verify });
  const central = new InMemoryCentralPod({ verify });
  const adapter = new MemoryChannelAdapter();
  const config = validateProjectConfig({
    projectId: 'demo', llm: { route: 'local', model: 'mock' },
    aggregation: { k: 1 }, privacy: { verify: true },
    signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  });
  const d = new ChannelDispatcher({ adapter, pod: ownPod, config, participant: 'p-1', identity: id, centralPod: central });
  return { id, ownPod, central, adapter, d };
}

async function seedOwnRaw(ownPod, id, raws) {
  for (const [i, text] of raws.entries()) {
    const c = buildContribution({ id: `p-1:p${i + 1}`, text }, { lang: 'nl' });
    await ownPod.write('p-1', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'p-1', contribution: c }));
  }
}

const mockSummarise = async ({ round }) => ({
  projectId: 'demo', round, summary: 'a verified summary', points: [{ id: 'p-1:p1', text: 'raw one' }],
  curatedFrom: ['p-1:p1'], generatedAt: 'now',
});

test('verify-turn: open round → verify → ONLY the verified summary reaches central; raw stays own', async () => {
  const { id, ownPod, central, adapter, d } = setup();
  await seedOwnRaw(ownPod, id, ['raw one', 'raw two']);

  await d.openVerificationRound({ round: 1, summarise: mockSummarise });
  const presented = adapter.sent.find((m) => m.type === 'verify-summary');
  assert.ok(presented, 'bot presents a verify-summary bubble');
  assert.equal(presented.summary, 'a verified summary');

  const cid = await d.command('verify');         // the [verify] button
  assert.equal(cid, 'p-1:summary:1');
  assert.ok(adapter.sent.some((m) => m.type === 'verified' && m.id === cid));

  assert.equal(central.list().length, 1, 'central holds exactly the verified summary');
  assert.ok(central.list()[0].contribution.themeTags.includes('verified-summary'));
  assert.equal(ownPod.list().length, 2, 'own pod still holds the raw');
});

test('verify-turn: WITHDRAW discards the draft; nothing reaches central', async () => {
  const { id, ownPod, central, adapter, d } = setup();
  await seedOwnRaw(ownPod, id, ['raw one']);
  await d.openVerificationRound({ round: 1, summarise: mockSummarise });
  await d.command('verify-withdraw');            // the [withdraw] button
  assert.ok(adapter.sent.some((m) => m.type === 'verification-withdrawn'));
  assert.equal(central.list().length, 0, 'nothing released');
  // a verify after withdraw is a no-op (no pending draft)
  await d.command('verify');
  assert.ok(adapter.sent.some((m) => m.type === 'verify-none'));
  assert.equal(central.list().length, 0);
});

test('verify-turn: EDIT rewords the summary; the edited text is what reaches central', async () => {
  const { id, ownPod, central, adapter, d } = setup();
  await seedOwnRaw(ownPod, id, ['raw one']);
  await d.openVerificationRound({ round: 1, summarise: mockSummarise });
  await d.command('verify-edit', 'my own wording');   // the [edit] button + new text
  const rePresented = adapter.sent.filter((m) => m.type === 'verify-summary');
  assert.equal(rePresented.at(-1).summary, 'my own wording');
  assert.ok(rePresented.at(-1).edited);
  await d.command('verify');
  assert.equal(central.list()[0].contribution.text, 'my own wording');
});

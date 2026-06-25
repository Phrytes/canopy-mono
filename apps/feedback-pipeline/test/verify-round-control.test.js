// Lead-trigger poll (Stage 2 trigger, docs/DESIGN-verify-summary-loop.md §3) — deterministic (mock summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import * as signing from '../src/pod/signing.js';
import { InMemoryRoundControl, PodRoundControl, openVerificationRound, pendingRoundsFor, pollAndOpenVerification } from '../src/verify/round-control.js';

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
  return { id, ownPod, central, adapter, d, control: new InMemoryRoundControl() };
}

const mockSummarise = async ({ round }) => ({
  projectId: 'demo', round, summary: `summary r${round}`, points: [{ id: 'p-1:p1', text: 'raw' }],
  curatedFrom: ['p-1:p1'], generatedAt: 'now',
});

test('lead-trigger: lead opens a round → bot poll opens the verify-turn → verify → no re-ask', async () => {
  const { central, adapter, d, control } = setup();

  const req = await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, openedBy: 'lead', message: 'please verify' });
  assert.equal(req.round, 1);

  const opened = await pollAndOpenVerification({ dispatcher: d, controlStore: control, projectId: 'demo', participant: 'p-1', centralPod: central, summarise: mockSummarise });
  assert.equal(opened.round, 1);
  assert.ok(adapter.sent.some((m) => m.type === 'verify-summary' && m.round === 1), 'bot presents the verify-summary on poll');

  await d.command('verify');                       // participant verifies
  assert.equal(central.list().length, 1, 'verified summary on central');

  const again = await pollAndOpenVerification({ dispatcher: d, controlStore: control, projectId: 'demo', participant: 'p-1', centralPod: central, summarise: mockSummarise });
  assert.equal(again, null, 'an already-verified round is not re-opened');
});

test('lead-trigger: openVerificationRound is idempotent per {projectId, round}', async () => {
  const { control } = setup();
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1 });
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1 });
  assert.equal((await control.listRounds('demo')).length, 1);
});

test('lead-trigger: pendingRoundsFor returns only unverified rounds, oldest first', async () => {
  const { central, d, control } = setup();
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, now: () => '2026-01-01' });
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 2, now: () => '2026-02-01' });
  let pending = await pendingRoundsFor({ controlStore: control, projectId: 'demo', participant: 'p-1', centralPod: central });
  assert.deepEqual(pending.map((r) => r.round), [1, 2]);

  await d.openVerificationRound({ round: 1, summarise: mockSummarise });
  await d.command('verify');
  pending = await pendingRoundsFor({ controlStore: control, projectId: 'demo', participant: 'p-1', centralPod: central });
  assert.deepEqual(pending.map((r) => r.round), [2], 'verified round 1 drops out');
});

test('PodRoundControl: pod-backed control store drives openVerificationRound + listRounds', async () => {
  const control = new PodRoundControl({ pod: new InMemoryCentralPod() });
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, openedBy: 'lead' });
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1 });   // idempotent
  await openVerificationRound({ controlStore: control, projectId: 'other', round: 1 });   // a different project
  const rounds = await control.listRounds('demo');
  assert.equal(rounds.length, 1, 'one round for demo (idempotent, project-filtered)');
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].openedBy, 'lead');
});

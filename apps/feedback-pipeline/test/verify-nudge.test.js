// Verify-summary push nudge (self-poll + self-notify) — deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import * as signing from '../src/pod/signing.js';
import { InMemoryRoundControl, openVerificationRound } from '../src/verify/round-control.js';
import { releaseVerifiedSummary } from '../src/verify/summary-round.js';
import { nudgeForVerification } from '../src/verify/nudge.js';

function setup() {
  const id = signing.generateParticipantIdentity();
  const roster = new signing.IdentityRoster();
  roster.bind('alice', id.publicKey, id.encPublicKey);
  const central = new InMemoryCentralPod({ verify: signing.makeContributionVerifier({ roster, projectId: 'demo' }) });
  return { id, central, control: new InMemoryRoundControl() };
}

test('nudge: fires once per pending round; suppressed by alreadyNudged', async () => {
  const { central, control } = setup();
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, message: 'graag verifiëren' });
  const fired = [];
  const notify = async (n) => { fired.push(n); };

  const nudged = await nudgeForVerification({ controlStore: control, projectId: 'demo', participant: 'alice', centralPod: central, notify });
  assert.deepEqual(nudged, [1]);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].round, 1);
  assert.equal(fired[0].message, 'graag verifiëren');

  // a second check that knows round 1 was already nudged → no repeat
  const seen = new Set([1]);
  const again = await nudgeForVerification({ controlStore: control, projectId: 'demo', participant: 'alice', centralPod: central, notify, alreadyNudged: (r) => seen.has(r) });
  assert.deepEqual(again, []);
  assert.equal(fired.length, 1, 'no repeat notification');
});

test('nudge: a verified round is not nudged', async () => {
  const { id, central, control } = setup();
  await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1 });
  await releaseVerifiedSummary({ centralPod: central, draft: { projectId: 'demo', round: 1, summary: 's' }, identity: id, participant: 'alice', lang: 'nl' });
  const fired = [];
  const nudged = await nudgeForVerification({ controlStore: control, projectId: 'demo', participant: 'alice', centralPod: central, notify: async (n) => fired.push(n) });
  assert.deepEqual(nudged, [], 'already verified → nothing to nudge');
  assert.equal(fired.length, 0);
});

test('nudge: no-op without a control store or notify', async () => {
  assert.deepEqual(await nudgeForVerification({ notify: async () => {} }), []);
  assert.deepEqual(await nudgeForVerification({ controlStore: new InMemoryRoundControl() }), []);
});

// Verify-summary loop (docs/DESIGN-verify-summary-loop.md) — the privacy invariant, deterministic (no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import * as signing from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';
import { releaseVerifiedSummary } from '../src/verify/summary-round.js';

function setup() {
  const id = signing.generateParticipantIdentity();
  const roster = new signing.IdentityRoster();
  roster.bind('alice', id.publicKey, id.encPublicKey);
  const verify = signing.makeContributionVerifier({ roster, projectId: 'demo' });
  return { id, verify };
}

async function ownPodWithRaw(id, verify, raws) {
  const pod = new InMemoryCentralPod({ verify });
  for (const [i, text] of raws.entries()) {
    const c = buildContribution({ id: `alice:p${i + 1}`, text }, { lang: 'nl' });
    await pod.write('alice', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'alice', contribution: c }));
  }
  return pod;
}

test('verify-summary: ONLY the verified summary reaches central; the raw stays in the own pod', async () => {
  const { id, verify } = setup();
  const raws = ['raw one', 'raw two'];
  const ownPod = await ownPodWithRaw(id, verify, raws);
  const central = new InMemoryCentralPod({ verify });

  const draft = { projectId: 'demo', round: 1, summary: 'a verified summary of alice feedback' };
  const cid = await releaseVerifiedSummary({ centralPod: central, draft, identity: id, participant: 'alice', lang: 'nl' });

  assert.equal(cid, 'alice:summary:1');
  const inCentral = central.list();
  assert.equal(inCentral.length, 1, 'central holds exactly one record');
  assert.ok(inCentral[0].contribution.themeTags.includes('verified-summary'), 'tagged verified-summary');
  assert.equal(inCentral[0].contribution.text, draft.summary, 'central holds the verified summary text');
  // the invariant: raw never left the own pod
  assert.equal(ownPod.list().length, raws.length, 'own pod still holds the raw');
  assert.ok(inCentral.every((r) => !raws.includes(r.contribution.text)), 'no raw text in central');
});

test('verify-summary: an empty summary cannot be released', async () => {
  const { id, verify } = setup();
  const central = new InMemoryCentralPod({ verify });
  await assert.rejects(
    () => releaseVerifiedSummary({ centralPod: central, draft: { projectId: 'demo', round: 1, summary: '' }, identity: id, participant: 'alice' }),
    /empty summary/,
  );
});

test('verify-summary: the released summary is SIGNED (a forged participant is rejected by the verifier)', async () => {
  const { id, verify } = setup();
  const central = new InMemoryCentralPod({ verify });
  const draft = { projectId: 'demo', round: 1, summary: 'signed summary' };
  // alice (in the roster) releases → accepted
  await releaseVerifiedSummary({ centralPod: central, draft, identity: id, participant: 'alice', lang: 'nl' });
  assert.equal(central.list().length, 1);
  // an unknown participant (not in the roster) → the verifier rejects the write
  const stranger = signing.generateParticipantIdentity();
  await assert.rejects(
    () => releaseVerifiedSummary({ centralPod: central, draft: { ...draft, round: 2 }, identity: stranger, participant: 'mallory', lang: 'nl' }),
  );
});

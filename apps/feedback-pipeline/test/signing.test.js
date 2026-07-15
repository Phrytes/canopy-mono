// PR-3 — participant signatures over contributions (plan security gap #1: authenticity /
// sybil). Proves: a valid signed contribution verifies and aggregates; an unsigned, forged,
// cross-project, or sybil (unregistered / swapped key) contribution is rejected at write and
// DROPPED at the aggregation read even if it was stored directly.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateParticipantIdentity, signContribution, verifyContribution,
  IdentityRoster, makeContributionVerifier, canonicalContribution,
} from '../src/pod/signing.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';

const projectId = 'proj-1';
const contribution = buildContribution({ id: 'p1:1', text: 'wachtlijst te lang' }, { lang: 'nl' });

test('property-layer: charter fields bind into the signature but stay BACK-COMPAT when absent', () => {
  // A pre-charter contribution (no attributes, no charterHash) must canonicalise to the ORIGINAL
  // 8-field shape so existing persisted signatures still verify.
  const plain = JSON.parse(canonicalContribution({ projectId, participant: 'p1', contribution }).toString());
  assert.equal(plain.length, 8, 'no attributes/charterHash → original 8-field canonical form');

  // With disclosed attributes + charterHash they append (bound into the signed bytes).
  const withCharter = buildContribution({ id: 'p1:2', text: 'x' }, { lang: 'nl', attributes: { place: 'Groningen' }, charterHash: 'ch1' });
  const bound = JSON.parse(canonicalContribution({ projectId, participant: 'p1', contribution: withCharter }).toString());
  assert.equal(bound.length, 10, 'attributes/charterHash present → appended into the canonical form');

  // A host STRIPPING the disclosed attributes after signing breaks verification (can't rewrite segmentation).
  const id = generateParticipantIdentity();
  const sig = signContribution({ projectId, participant: 'p1', contribution: withCharter }, id.privateKey);
  assert.equal(verifyContribution({ projectId, participant: 'p1', contribution: withCharter }, sig, id.publicKey), true);
  const stripped = buildContribution({ id: 'p1:2', text: 'x' }, { lang: 'nl' });   // attributes removed
  assert.equal(verifyContribution({ projectId, participant: 'p1', contribution: stripped }, sig, id.publicKey), false);
});

test('sign/verify round-trips; tamper + wrong-key + cross-project are rejected', () => {
  const id = generateParticipantIdentity();
  const sig = signContribution({ projectId, participant: 'p1', contribution }, id.privateKey);
  assert.equal(verifyContribution({ projectId, participant: 'p1', contribution }, sig, id.publicKey), true);

  // tampered text
  const tampered = { ...contribution, text: 'iets anders' };
  assert.equal(verifyContribution({ projectId, participant: 'p1', contribution: tampered }, sig, id.publicKey), false);
  // different signer
  const other = generateParticipantIdentity();
  assert.equal(verifyContribution({ projectId, participant: 'p1', contribution }, sig, other.publicKey), false);
  // replayed under another pseudonym / another project
  assert.equal(verifyContribution({ projectId, participant: 'p2', contribution }, sig, id.publicKey), false);
  assert.equal(verifyContribution({ projectId: 'other', participant: 'p1', contribution }, sig, id.publicKey), false);
});

test('IdentityRoster: one pseudonym binds one key; rebinding a different key is refused', () => {
  const roster = new IdentityRoster();
  const a = generateParticipantIdentity();
  roster.bind('p1', a.publicKey);
  roster.bind('p1', a.publicKey);                                  // idempotent
  assert.equal(roster.keyFor('p1'), a.publicKey);
  assert.throws(() => roster.bind('p1', generateParticipantIdentity().publicKey), /different key/);
});

test('verifier enforces authenticity AND membership (anti-sybil)', () => {
  const roster = new IdentityRoster();
  const id = generateParticipantIdentity();
  roster.bind('p1', id.publicKey);
  const verify = makeContributionVerifier({ roster, projectId });
  const sig = signContribution({ projectId, participant: 'p1', contribution }, id.privateKey);

  assert.doesNotThrow(() => verify('p1', contribution, { sig, pubKey: id.publicKey }));
  assert.throws(() => verify('p1', contribution, {}), /unsigned/);
  // a sybil: a valid signature from an UNREGISTERED key
  const sybil = generateParticipantIdentity();
  const sybilSig = signContribution({ projectId, participant: 'p1', contribution }, sybil.privateKey);
  assert.throws(() => verify('p1', contribution, { sig: sybilSig, pubKey: sybil.publicKey }), /does not match/);
  // an unknown participant entirely
  assert.throws(() => verify('ghost', contribution, { sig, pubKey: id.publicKey }), /not a verified member/);
});

test('InMemoryCentralPod: write gates unsigned; aggregation includes verified, drops the rest', () => {
  const roster = new IdentityRoster();
  const a = generateParticipantIdentity(); const b = generateParticipantIdentity();
  roster.bind('pa', a.publicKey); roster.bind('pb', b.publicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId }) });

  const ca = buildContribution({ id: 'pa:1', text: 'GGZ wachtlijst te lang' }, { lang: 'nl' });
  const cb = buildContribution({ id: 'pb:1', text: 'parkeren te duur' }, { lang: 'nl' });
  pod.write('pa', ca, { sig: signContribution({ projectId, participant: 'pa', contribution: ca }, a.privateKey), pubKey: a.publicKey });
  pod.write('pb', cb, { sig: signContribution({ projectId, participant: 'pb', contribution: cb }, b.privateKey), pubKey: b.publicKey });

  // honest-client gate: unsigned write throws
  const cc = buildContribution({ id: 'pa:2', text: 'iets' });
  assert.throws(() => pod.write('pa', cc, {}), /unsigned/);

  const agg = pod.forAggregation();
  assert.equal(agg.length, 2);
  assert.deepEqual(agg.map((x) => x.id).sort(), ['pa:1', 'pb:1']);
});

test('CssCentralPod: a contribution PUT directly with a forged key is DROPPED at aggregation', async () => {
  const roster = new IdentityRoster();
  const a = generateParticipantIdentity();
  roster.bind('pa', a.publicKey);
  const verify = makeContributionVerifier({ roster, projectId });

  // a bare fake CSS
  const store = new Map();
  const fetch = async (uri, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') { store.set(uri, init.body); return { ok: true, status: 201 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    const kids = [...store.keys()].filter((k) => k.startsWith(uri) && k !== uri);
    if (kids.length) return { ok: true, status: 200, text: async () => kids.map((k) => `<${k}>`).join('\n'), json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const base = 'https://pods.example/proj-1/central/';
  const pod = new CssCentralPod({ authedFetch: fetch, podBase: base, verify });

  // legit signed write
  const ca = buildContribution({ id: 'pa:1', text: 'echt signaal' }, { lang: 'nl' });
  await pod.write('pa', ca, { sig: signContribution({ projectId, participant: 'pa', contribution: ca }, a.privateKey), pubKey: a.publicKey });

  // a malicious writer bypasses write() and PUTs an injected contribution straight to CSS,
  // signed with an UNREGISTERED key (sybil) under a forged pseudonym
  const sybil = generateParticipantIdentity();
  const cx = buildContribution({ id: 'evil:1', text: 'injected' });
  store.set(`${base}evil/evil%3A1.json`, JSON.stringify({
    participant: 'evil', contribution: cx, status: 'submitted',
    sig: signContribution({ projectId, participant: 'evil', contribution: cx }, sybil.privateKey), pubKey: sybil.publicKey,
  }));

  const agg = await pod.forAggregation();
  assert.equal(agg.length, 1, 'only the verified contribution survives aggregation');
  assert.equal(agg[0].id, 'pa:1');
});

test('verification is off by default (backward-compatible: unsigned writes pass)', () => {
  const pod = new InMemoryCentralPod();
  pod.write('pa', buildContribution({ id: 'pa:1', text: 'x' }));   // no meta, no verifier
  assert.equal(pod.forAggregation().length, 1);
});

// PR-4 — bring-your-own-pod aggregation + the TEE aggregation boundary.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ByoCentralPod, assertByoReadable } from '../src/pod/byo-central-pod.js';
import { assertCentralPod } from '../src/pod/central-pod-interface.js';
import { runSealedAggregation } from '../src/tee/aggregate.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair, makeSealer, makeOpener } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, signContribution, IdentityRoster, makeContributionVerifier } from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';

const projectId = 'byo-project';
const cfg = (privacy) => validateProjectConfig({ projectId, llm: { route: 'local', model: 'm' }, aggregation: { k: 1 }, ...(privacy ? { privacy } : {}) });

// a participant's own pod produces sealed+signed records (the BYO contract)
function byoRecord({ id, text, participant, identity, projectKey }) {
  const c = buildContribution({ id, text }, { lang: 'nl' });
  const sealed = { ...c, text: makeSealer([projectKey.publicKey])(c.text) };
  return { contribution: sealed, sig: signContribution({ projectId, participant, contribution: c }, identity.privateKey), pubKey: identity.publicKey };
}

test('the CentralPod contract is duck-typed; ByoCentralPod satisfies the read subset', () => {
  assertCentralPod(new InMemoryCentralPod());                 // full backend
  assertByoReadable(new ByoCentralPod());                     // read-only BYO view
  assert.throws(() => assertCentralPod(new ByoCentralPod()), /missing method/);   // BYO has no write
  assert.throws(() => assertCentralPod({}), /missing method/);
});

test('ByoCentralPod aggregates across participant-owned pods, opening + verifying each', async () => {
  const projectKey = generateProjectKeypair();
  const anils = generateParticipantIdentity(), bryn = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('anils', anils.publicKey, anils.encPublicKey);
  roster.bind('bryn', bryn.publicKey, bryn.encPublicKey);

  const pod = new ByoCentralPod({
    open: makeOpener(projectKey.privateKey),
    verify: makeContributionVerifier({ roster, projectId }),
    sources: [
      { participant: 'anils', read: async () => [byoRecord({ id: 'anils:1', text: 'GGZ-wachtlijst te lang', participant: 'anils', identity: anils, projectKey })] },
      { participant: 'bryn', read: async () => [byoRecord({ id: 'bryn:1', text: 'parkeren te duur', participant: 'bryn', identity: bryn, projectKey })] },
    ],
  });

  const agg = await pod.forAggregation();
  assert.equal(agg.length, 2);
  assert.deepEqual(agg.map((x) => x.text).sort(), ['GGZ-wachtlijst te lang', 'parkeren te duur']);
});

test('BYO: an unverified / sybil source is dropped; an unreachable pod contributes nothing', async () => {
  const projectKey = generateProjectKeypair();
  const anils = generateParticipantIdentity(), sybil = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('anils', anils.publicKey);   // only anils is a member

  const pod = new ByoCentralPod({
    open: makeOpener(projectKey.privateKey),
    verify: makeContributionVerifier({ roster, projectId }),
    sources: [
      { participant: 'anils', read: async () => [byoRecord({ id: 'anils:1', text: 'echt signaal', participant: 'anils', identity: anils, projectKey })] },
      { participant: 'sybil', read: async () => [byoRecord({ id: 'sybil:1', text: 'astroturf', participant: 'sybil', identity: sybil, projectKey })] },
      { participant: 'offline', read: async () => { throw new Error('pod unreachable'); } },
    ],
  });

  const agg = await pod.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].user, 'anils');
});

test('TEE boundary: opens+verifies+aggregates inside; returns only the aggregate + attestation', async () => {
  const projectKey = generateProjectKeypair();
  const anils = generateParticipantIdentity(), bryn = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('anils', anils.publicKey); roster.bind('bryn', bryn.publicKey);
  const config = cfg({ seal: true, verify: true, keygen: 'host', projectPublicKey: projectKey.publicKey });

  const sealedStore = [
    { participant: 'anils', ...byoRecord({ id: 'anils:1', text: 'wachtlijst te lang', participant: 'anils', identity: anils, projectKey }) },
    { participant: 'bryn', ...byoRecord({ id: 'bryn:1', text: 'parkeren te duur', participant: 'bryn', identity: bryn, projectKey }) },
  ];

  // a non-LLM aggregator stand-in: count distinct users + echo themes (the real one runs in-enclave)
  const aggregate = async (items) => ({ users: new Set(items.map((i) => i.user)).size, texts: items.map((i) => i.text).sort() });

  const out = await runSealedAggregation({
    config, projectPrivateKey: projectKey.privateKey, roster,
    readSealed: async () => sealedStore, aggregate,
  });

  assert.equal(out.contributionCount, 2);
  assert.equal(out.aggregate.users, 2);
  assert.deepEqual(out.aggregate.texts, ['parkeren te duur', 'wachtlijst te lang']);
  assert.equal(out.attestation.kind, 'phase1-no-tee');
  assert.equal(out.attestation.verified, false);
  assert.equal(out.attestation.runner, 'host');
  // the boundary leaks neither the key nor the plaintext records
  assert.ok(!('privateKey' in out) && !('items' in out) && !('records' in out));
  assert.ok(!JSON.stringify(out.attestation).includes(projectKey.privateKey));
});

test('TEE boundary reads a sealed CssCentralPod end-to-end (open happens only inside)', async () => {
  const projectKey = generateProjectKeypair();
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('pa', id.publicKey);
  const config = cfg({ seal: true, verify: true, keygen: 'host', projectPublicKey: projectKey.publicKey });

  // a fake CSS holding a sealed+signed write
  const store = new Map();
  const fetch = async (uri, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    if (m === 'PUT') { store.set(uri, init.body); return { ok: true, status: 201 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    const kids = [...store.keys()].filter((k) => k.startsWith(uri) && k !== uri);
    if (kids.length) return { ok: true, status: 200, json: async () => ({}), text: async () => kids.map((k) => `<${k}>`).join('\n') };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const base = 'https://pods.example/byo/central/';
  const writer = new CssCentralPod({ authedFetch: fetch, podBase: base, seal: makeSealer([projectKey.publicKey]), verify: makeContributionVerifier({ roster, projectId }) });
  const c = buildContribution({ id: 'pa:1', text: 'sealed via css' }, { lang: 'nl' });
  await writer.write('pa', c, { sig: signContribution({ projectId, participant: 'pa', contribution: c }, id.privateKey), pubKey: id.publicKey });

  // readSealed pulls the raw stored records (still sealed) — the boundary opens them inside
  const readSealed = async () => [...store.values()].map((b) => JSON.parse(b)).map((e) => ({ participant: e.participant, contribution: e.contribution, sig: e.sig, pubKey: e.pubKey }));
  const out = await runSealedAggregation({
    config, projectPrivateKey: projectKey.privateKey, roster, readSealed,
    aggregate: async (items) => items.map((i) => i.text),
  });
  assert.deepEqual(out.aggregate, ['sealed via css']);
});

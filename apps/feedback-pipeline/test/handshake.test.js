// PR-3 — the HI handshake: signed identity registration folded into activation, so one
// code → one verified identity (anti-sybil), and the end-to-end loop from portal → activate
// → roster → verified aggregation. Also proves wire-compatibility with the real substrate
// AgentIdentity (so participants can run actual canopy agents).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  generateParticipantIdentity, signRegistration, verifyRegistration,
  signContribution, canonicalContribution, verifyContribution,
} from '../src/pod/signing.js';
import { activate } from '../src/activation/activate.js';
import { InMemoryCohortRegistry } from '../src/activation/cohort.js';
import { createActivationServer } from '../src/activation/server.js';
import { ProjectStore } from '../src/portal/project-store.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { AgentIdentity } from '@canopy/core';
import { randomBytes } from 'node:crypto';

const future = new Date(Date.now() + 7 * 864e5).toISOString();
const now = () => new Date().toISOString();
const pseudonym = (webId) => `p-${createHash('sha256').update(webId).digest('hex').slice(0, 16)}`;

test('registration self-signature proves key ownership; tamper/wrong-code rejected', () => {
  const id = generateParticipantIdentity();
  const proof = signRegistration({ projectId: 'x', code: 'c1', pubKey: id.publicKey }, id.privateKey);
  assert.equal(verifyRegistration({ projectId: 'x', code: 'c1', pubKey: id.publicKey }, proof), true);
  assert.equal(verifyRegistration({ projectId: 'x', code: 'c2', pubKey: id.publicKey }, proof), false);   // bound to the code
  assert.equal(verifyRegistration({ projectId: 'y', code: 'c1', pubKey: id.publicKey }, proof), false);   // bound to the project
  const other = generateParticipantIdentity();
  assert.equal(verifyRegistration({ projectId: 'x', code: 'c1', pubKey: other.publicKey }, proof), false); // not that key
});

test('activate(): valid proof binds identity atomically with redeem; invalid proof spends nothing', async () => {
  const registry = new InMemoryCohortRegistry();
  registry.registerProject({ projectId: 'p', expiresAt: future, ceiling: 5 }, 'secret');
  const [code, code2] = registry.generateCodes('p', 2);
  const id = generateParticipantIdentity();
  const bound = [];
  const provisionPod = async () => ({ podRef: 'pod://p/u/' });
  const onIdentity = (ctx) => bound.push(ctx.pubKey);   // pseudonym mapping is the wiring's job (see e2e)

  // invalid proof → refused, code NOT spent, nothing bound
  const bad = await activate({ registry, projectId: 'p', code, recoveryHash: 'rh', now: now(),
    provisionPod, pubKey: id.publicKey, proof: 'AAAA', onIdentity });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /invalid identity proof/);
  assert.equal(registry.activationCount('p'), 0);
  assert.equal(bound.length, 0);

  // valid proof → redeemed + bound (atomic)
  const proof = signRegistration({ projectId: 'p', code, pubKey: id.publicKey }, id.privateKey);
  const ok = await activate({ registry, projectId: 'p', code, recoveryHash: 'rh', now: now(),
    provisionPod, pubKey: id.publicKey, proof, onIdentity });
  assert.equal(ok.ok, true);
  assert.equal(registry.activationCount('p'), 1);
  assert.deepEqual(bound, [id.publicKey]);
  assert.ok(code2);   // a second code remains
});

test('end-to-end: portal → activate(HI) → roster → only verified contributions aggregate', async () => {
  // 1. a project that REQUIRES signatures
  const store = new ProjectStore();
  store.createProject({
    config: { projectId: 'civic', llm: { route: 'local', model: 'm' }, aggregation: { k: 1 }, privacy: { verify: true } },
    cohort: { expiresAt: future, ceiling: 10 },
  });
  const [code] = store.generateCodes('civic', 1);

  // 2. participant activates with a signed identity registration (the HI handshake)
  const id = generateParticipantIdentity();
  const webId = 'https://id.example/alice#me';
  const proof = signRegistration({ projectId: 'civic', code, pubKey: id.publicKey }, id.privateKey);
  const server = createActivationServer({
    registry: store.cohort(),
    provisionPod: async () => ({ podRef: 'pod://civic/alice/' }),
    onIdentity: ({ projectId, pubKey, webId }) => store.bindIdentity(projectId, pseudonym(webId), pubKey),
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const act = await fetch(`http://localhost:${port}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'civic', code, recoveryHash: 'rh', webId, pubKey: id.publicKey, proof }),
  }).then((r) => r.json());
  server.close();
  assert.equal(act.ok, true);
  const me = pseudonym(webId);
  assert.equal(store.roster('civic').keyFor(me), id.publicKey);   // bound

  // 3. the central pod uses the project's verifier (built from the shared roster)
  const pod = new InMemoryCentralPod({ verify: store.verifierFor('civic') });
  const c = buildContribution({ id: `${me}:1`, text: 'wachtlijst te lang' }, { lang: 'nl' });
  pod.write(me, c, { sig: signContribution({ projectId: 'civic', participant: me, contribution: c }, id.privateKey), pubKey: id.publicKey });

  // a sybil who never activated cannot get in (unregistered key, even with a valid signature)
  const sybil = generateParticipantIdentity();
  const sc = buildContribution({ id: 'sybil:1', text: 'astroturf' });
  assert.throws(() => pod.write('sybil', sc, { sig: signContribution({ projectId: 'civic', participant: 'sybil', contribution: sc }, sybil.privateKey), pubKey: sybil.publicKey }), /not a verified member/);

  const agg = pod.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].user, me);
});

test('substrate interop: a real AgentIdentity and our verifier accept each other', () => {
  const projectId = 'civic', participant = 'p1';
  const contribution = buildContribution({ id: 'p1:1', text: 'echt signaal' }, { lang: 'nl' });
  const msg = canonicalContribution({ projectId, participant, contribution });

  // a participant running the actual canopy substrate signs
  const agent = new AgentIdentity({ seed: new Uint8Array(randomBytes(32)), vault: {} });
  const sigB64 = Buffer.from(agent.sign(msg)).toString('base64url');
  assert.equal(verifyContribution({ projectId, participant, contribution }, sigB64, agent.pubKey), true);

  // and our signature verifies under the substrate's checker
  const me = generateParticipantIdentity();
  const mySig = signContribution({ projectId, participant, contribution }, me.privateKey);
  assert.equal(AgentIdentity.verify(msg, Buffer.from(mySig, 'base64url'), me.publicKey), true);
});

// PR-2 — the portal: multi-tenant ProjectStore + JSON API + the menukaart→config→cohort
// flow. Proves a lead can create a project, mint invite links, and that codes redeem
// against the SAME cohort the activation service uses; and that host keygen yields a
// working project keypair while only the public key is persisted.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, inviteLink } from '../src/portal/project-store.js';
import { handlePortal, createPortalServer } from '../src/portal/server.js';
import { seal, open, generateProjectKeypair } from '../src/pod/project-seal.js';
import { createActivationServer } from '../src/activation/server.js';

const future = new Date(Date.now() + 7 * 864e5).toISOString();
const baseConfig = (id) => ({ projectId: id, projectName: 'Wijk', llm: { route: 'local', model: 'm' }, aggregation: { k: 3 } });
const post = (store, path, body, inviteBase) => handlePortal({ method: 'POST', path, body, store, inviteBase });
const get = (store, path) => handlePortal({ method: 'GET', path, store });

test('ProjectStore: create, validate, status, codes against the shared cohort', async () => {
  const store = new ProjectStore();
  store.createProject({ config: baseConfig('p1'), cohort: { expiresAt: future, ceiling: 10 } });
  assert.throws(() => store.createProject({ config: baseConfig('p1'), cohort: { expiresAt: future, ceiling: 10 } }), /already exists/);

  const s = store.status('p1');
  assert.equal(s.activations, 0); assert.equal(s.ceiling, 10); assert.equal(s.seal, false);

  const codes = store.generateCodes('p1', 5);
  assert.equal(codes.length, 5);
  assert.equal(new Set(codes).size, 5);                          // unique
  // the SAME registry validates them (membership proof, no stored issued set)
  assert.equal(store.cohort().validate('p1', codes[0], new Date().toISOString()).ok, true);
});

test('API: create → list → status → codes (+ invite links)', async () => {
  const store = new ProjectStore();
  const created = await post(store, '/api/projects', { config: baseConfig('alpha'), cohort: { expiresAt: future, ceiling: 50 } });
  assert.equal(created.status, 201);
  assert.equal(created.json.projectId, 'alpha');
  assert.ok(!created.json.projectPrivateKey);                    // no key for an unsealed project

  const list = await get(store, '/api/projects');
  assert.equal(list.json.projects.length, 1);
  assert.equal(list.json.projects[0].projectId, 'alpha');

  const codes = await post(store, '/api/projects/alpha/codes', { count: 3 }, 'https://activate.example/');
  assert.equal(codes.json.codes.length, 3);
  assert.equal(codes.json.links.length, 3);
  assert.match(codes.json.links[0], /^https:\/\/activate\.example\/\?projectId=alpha&code=/);
});

test('API: menukaart validation errors surface as 400 (seal without a key, non-host keygen)', async () => {
  const store = new ProjectStore();
  const bad = await post(store, '/api/projects', {
    config: { ...baseConfig('bad'), privacy: { seal: true, keygen: 'client' } },
    cohort: { expiresAt: future, ceiling: 5 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.reason, /projectPublicKey/);
});

test('host keygen: returns a working keypair once; only the public key is stored', async () => {
  const store = new ProjectStore();
  const res = await post(store, '/api/projects', {
    config: { ...baseConfig('sealed'), privacy: { seal: true, keygen: 'host' } },
    cohort: { expiresAt: future, ceiling: 5 },
  });
  assert.equal(res.status, 201);
  assert.ok(res.json.projectPrivateKey, 'private key returned once');
  assert.match(res.json.keyNotice, /shown once/);

  const pub = store.getConfig('sealed').privacy.projectPublicKey;
  assert.ok(pub, 'public key persisted');
  // the persisted store must NOT contain the private key anywhere
  assert.ok(!JSON.stringify(store.toJSON()).includes(res.json.projectPrivateKey), 'private key never persisted');
  // the returned pair actually works end to end
  assert.equal(open(seal('hoi', pub), res.json.projectPrivateKey), 'hoi');
});

test('client/external keygen: lead supplies the public key; it is stored and usable', async () => {
  const store = new ProjectStore();
  const kp = generateProjectKeypair();   // a key the lead generated offline (client/external)
  const res = await post(store, '/api/projects', {
    config: { ...baseConfig('byo'), privacy: { seal: true, keygen: 'external', projectPublicKey: kp.publicKey } },
    cohort: { expiresAt: future, ceiling: 5 },
  });
  assert.equal(res.status, 201);
  assert.ok(!res.json.projectPrivateKey, 'host never sees the private key for external keygen');
  assert.equal(store.getConfig('byo').privacy.projectPublicKey, kp.publicKey);
});

test('persistence round-trips the store (configs + cohort)', async () => {
  const store = new ProjectStore();
  store.createProject({ config: baseConfig('keep'), cohort: { expiresAt: future, ceiling: 9 } });
  const reloaded = ProjectStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  assert.equal(reloaded.status('keep').ceiling, 9);
  assert.equal(reloaded.getConfig('keep').aggregation.k, 3);
});

test('end-to-end: a portal-minted code activates via the activation service (shared cohort)', async () => {
  const store = new ProjectStore();
  store.createProject({ config: baseConfig('e2e'), cohort: { expiresAt: future, ceiling: 5 } });
  const [code] = store.generateCodes('e2e', 1);

  // the activation service runs on the SAME cohort registry the portal issued from
  const provisionPod = async () => ({ podRef: 'https://pods.example/e2e/p-x/' });
  const server = createActivationServer({ registry: store.cohort(), provisionPod });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'e2e', code, recoveryHash: 'rh', webId: 'https://id.example/me#me' }),
  }).then((r) => r.json());
  server.close();
  assert.equal(res.ok, true);
  assert.equal(res.podRef, 'https://pods.example/e2e/p-x/');
  assert.equal(store.cohort().activationCount('e2e'), 1);        // the portal sees the activation
});

test('inviteLink encodes projectId + code', async () => {
  assert.equal(inviteLink('https://a.example/', 'p 1', 'abc-def'),
    'https://a.example/?projectId=p+1&code=abc-def');
});

test('per-project inviteBase overrides the portal default; absent → falls back', async () => {
  const store = new ProjectStore();
  // project WITH its own base
  await post(store, '/api/projects', { config: baseConfig('own'), cohort: { expiresAt: future, ceiling: 5 }, inviteBase: 'https://own.example/' });
  assert.equal(store.inviteBaseFor('own'), 'https://own.example/');
  assert.equal(store.status('own').inviteBase, 'https://own.example/');
  // its own base wins even when a different portal default is passed
  const a = await post(store, '/api/projects/own/codes', { count: 2 }, 'https://portal-default.example/');
  assert.equal(a.json.links.length, 2);
  assert.match(a.json.links[0], /^https:\/\/own\.example\/\?projectId=own&code=/);

  // project WITHOUT its own base → uses the portal default
  await post(store, '/api/projects', { config: baseConfig('plain'), cohort: { expiresAt: future, ceiling: 5 } });
  assert.equal(store.status('plain').inviteBase, null);
  const b = await post(store, '/api/projects/plain/codes', { count: 1 }, 'https://portal-default.example/');
  assert.match(b.json.links[0], /^https:\/\/portal-default\.example\/\?projectId=plain&code=/);
  // and with neither a project base nor a portal default → codes, no links
  const c = await post(store, '/api/projects/plain/codes', { count: 1 });
  assert.equal(c.json.codes.length, 1);
  assert.equal(c.json.links.length, 0);
});

test('an invalid per-project inviteBase is rejected at create (400)', async () => {
  const store = new ProjectStore();
  const bad = await post(store, '/api/projects', { config: baseConfig('badurl'), cohort: { expiresAt: future, ceiling: 5 }, inviteBase: 'not a url' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.reason, /invalid inviteBase/);
});

test('inviteBase round-trips through persistence', async () => {
  const store = new ProjectStore();
  store.createProject({ config: baseConfig('persisted'), cohort: { expiresAt: future, ceiling: 5 }, inviteBase: 'https://keep.example/' });
  const reloaded = ProjectStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  assert.equal(reloaded.inviteBaseFor('persisted'), 'https://keep.example/');
});

test('verification rounds: lead opens a round (idempotent), lists it, persists', async () => {
  const store = new ProjectStore();
  store.createProject({ config: baseConfig('vr'), cohort: { expiresAt: future, ceiling: 5 } });
  const r1 = await store.openRound('vr', 1, { openedBy: 'lead', message: 'verify please' });
  assert.equal(r1.round, 1);
  await store.openRound('vr', 1);                                 // idempotent
  const rounds = await store.listRounds('vr');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].openedBy, 'lead');
  const reloaded = ProjectStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  assert.equal((await reloaded.listRounds('vr')).length, 1, 'rounds survive persistence');
});

test('API: POST/GET /api/projects/:id/rounds opens + lists verification rounds', async () => {
  const store = new ProjectStore();
  await post(store, '/api/projects', { config: baseConfig('api-vr'), cohort: { expiresAt: future, ceiling: 5 } });
  const opened = await post(store, '/api/projects/api-vr/rounds', { round: 2, openedBy: 'lead' });
  assert.equal(opened.status, 200);
  assert.equal(opened.json.round.round, 2);
  const bad = await post(store, '/api/projects/api-vr/rounds', {});   // no round → 400
  assert.equal(bad.status, 400);
  const list = await get(store, '/api/projects/api-vr/rounds');
  assert.equal(list.json.rounds.length, 1);
  assert.equal(list.json.rounds[0].round, 2);
});

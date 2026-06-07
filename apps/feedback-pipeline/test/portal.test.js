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

test('ProjectStore: create, validate, status, codes against the shared cohort', () => {
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

test('API: create → list → status → codes (+ invite links)', () => {
  const store = new ProjectStore();
  const created = post(store, '/api/projects', { config: baseConfig('alpha'), cohort: { expiresAt: future, ceiling: 50 } });
  assert.equal(created.status, 201);
  assert.equal(created.json.projectId, 'alpha');
  assert.ok(!created.json.projectPrivateKey);                    // no key for an unsealed project

  const list = get(store, '/api/projects');
  assert.equal(list.json.projects.length, 1);
  assert.equal(list.json.projects[0].projectId, 'alpha');

  const codes = post(store, '/api/projects/alpha/codes', { count: 3 }, 'https://activate.example/');
  assert.equal(codes.json.codes.length, 3);
  assert.equal(codes.json.links.length, 3);
  assert.match(codes.json.links[0], /^https:\/\/activate\.example\/\?projectId=alpha&code=/);
});

test('API: menukaart validation errors surface as 400 (seal without a key, non-host keygen)', () => {
  const store = new ProjectStore();
  const bad = post(store, '/api/projects', {
    config: { ...baseConfig('bad'), privacy: { seal: true, keygen: 'client' } },
    cohort: { expiresAt: future, ceiling: 5 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.reason, /projectPublicKey/);
});

test('host keygen: returns a working keypair once; only the public key is stored', () => {
  const store = new ProjectStore();
  const res = post(store, '/api/projects', {
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

test('client/external keygen: lead supplies the public key; it is stored and usable', () => {
  const store = new ProjectStore();
  const kp = generateProjectKeypair();   // a key the lead generated offline (client/external)
  const res = post(store, '/api/projects', {
    config: { ...baseConfig('byo'), privacy: { seal: true, keygen: 'external', projectPublicKey: kp.publicKey } },
    cohort: { expiresAt: future, ceiling: 5 },
  });
  assert.equal(res.status, 201);
  assert.ok(!res.json.projectPrivateKey, 'host never sees the private key for external keygen');
  assert.equal(store.getConfig('byo').privacy.projectPublicKey, kp.publicKey);
});

test('persistence round-trips the store (configs + cohort)', () => {
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

test('inviteLink encodes projectId + code', () => {
  assert.equal(inviteLink('https://a.example/', 'p 1', 'abc-def'),
    'https://a.example/?projectId=p+1&code=abc-def');
});

// PR-1 — at-rest sealing of the central pod to a project key. Proves the key model:
// the writer needs only the PUBLIC key (host-blind), opening needs a recipient PRIVATE
// key, non-recipients fail, and the central pod stores ciphertext / refuses to aggregate
// while locked — while status/withdraw still work locked (they use only the id).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateProjectKeypair, seal, open, isSealed, makeSealer, makeOpener,
} from '../src/pod/project-seal.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { validateProjectConfig } from '../src/config/project-config.js';

// minimal in-memory CSS over the fetch contract CssCentralPod uses (as in css-wiring.test.js)
function fakeCss() {
  const store = new Map();
  const fetch = async (uri, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') { store.set(uri, init.body); return { ok: true, status: 201 }; }
    if (method === 'DELETE') { store.delete(uri); return { ok: true, status: 205 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    // a turtle listing of the children so #resourceUris can walk it
    const kids = [...store.keys()].filter((k) => k.startsWith(uri) && k !== uri);
    if (kids.length) return { ok: true, status: 200, json: async () => ({}), text: async () => kids.map((k) => `<${k}>`).join('\n') };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, store };
}

test('seal/open round-trips; writer needs only the public key; ciphertext hides content', () => {
  const proj = generateProjectKeypair();
  const env = seal('De GGZ wachtlijst is te lang', proj.publicKey);   // only the PUBLIC key
  assert.ok(isSealed(env));
  assert.ok(!env.includes('GGZ'));                                     // opaque
  assert.equal(open(env, proj.privateKey), 'De GGZ wachtlijst is te lang');
});

test('non-recipient cannot open; multi-recipient: every recipient opens, outsider fails', () => {
  const proj = generateProjectKeypair();
  const alice = generateProjectKeypair();
  const bob = generateProjectKeypair();
  const solo = seal('x', proj.publicKey);
  assert.throws(() => open(solo, alice.privateKey), /not a recipient/);
  const team = seal('team-secret', [proj.publicKey, alice.publicKey]);
  assert.equal(open(team, proj.privateKey), 'team-secret');
  assert.equal(open(team, alice.privateKey), 'team-secret');
  assert.throws(() => open(team, bob.privateKey), /not a recipient/);
});

test('open passes plaintext through (mixed / pre-seal data)', () => {
  const { privateKey } = generateProjectKeypair();
  assert.equal(open('plain, never sealed', privateKey), 'plain, never sealed');
});

test('InMemoryCentralPod: sealed write stores ciphertext; locked read throws; opener reveals', () => {
  const proj = generateProjectKeypair();
  const sealed = new InMemoryCentralPod({ seal: makeSealer([proj.publicKey]) });   // no opener → locked
  sealed.write('p1', buildContribution({ id: 'p1:1', text: 'wachtlijst te lang' }, { lang: 'nl' }));

  // status + withdraw work while locked (id only, no text)
  assert.equal(sealed.getStatus('p1:1'), 'submitted');
  // but the text boundaries refuse without a key
  assert.throws(() => sealed.list(), /sealed and no opener/);
  assert.throws(() => sealed.forAggregation(), /sealed and no opener/);

  // the keyless job supplies `open` after unwrap → readable
  const unlocked = new InMemoryCentralPod({ open: makeOpener(proj.privateKey) });
  // re-seal into a fresh unlocked pod to read the SAME stored bytes path
  const env = makeSealer([proj.publicKey])('wachtlijst te lang');
  unlocked.write('p1', buildContribution({ id: 'p1:1', text: env }, { lang: 'nl' }));
  assert.equal(unlocked.forAggregation()[0].text, 'wachtlijst te lang');
});

test('InMemoryCentralPod with both seal+open: round-trips end to end', () => {
  const proj = generateProjectKeypair();
  const pod = new InMemoryCentralPod({ seal: makeSealer([proj.publicKey]), open: makeOpener(proj.privateKey) });
  pod.write('p1', buildContribution({ id: 'p1:1', text: 'parkeren te duur' }));
  assert.equal(pod.forAggregation()[0].text, 'parkeren te duur');
  assert.equal(pod.list()[0].contribution.text, 'parkeren te duur');
});

test('CssCentralPod: PUT body is ciphertext; locked aggregation throws; opener reveals', async () => {
  const proj = generateProjectKeypair();
  const css = fakeCss();
  const base = 'https://pods.example/project/central/';
  const writer = new CssCentralPod({ authedFetch: css.fetch, podBase: base, seal: makeSealer([proj.publicKey]) });
  await writer.write('part-a', buildContribution({ id: 'a1', text: 'GGZ wachtlijst te lang' }, { lang: 'nl' }));

  // the stored resource holds ciphertext, not the plaintext
  const stored = [...css.store.values()].join('');
  assert.ok(!stored.includes('GGZ'), 'plaintext must not be on the wire/pod');
  assert.ok(stored.includes('fp1:'), 'sealed envelope present');

  // a host-blind reader (no key) cannot aggregate
  const locked = new CssCentralPod({ authedFetch: css.fetch, podBase: base });
  await assert.rejects(() => locked.forAggregation(), /sealed and no opener/);

  // the keyless job (with the unwrapped private key) reads it
  const job = new CssCentralPod({ authedFetch: css.fetch, podBase: base, open: makeOpener(proj.privateKey) });
  const agg = await job.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].text, 'GGZ wachtlijst te lang');
});

test('ProjectConfig: privacy defaults off; seal requires a project public key', () => {
  const base = { projectId: 'p', llm: { route: 'local', model: 'm' }, aggregation: { k: 2 } };
  const def = validateProjectConfig(base);
  assert.equal(def.privacy.seal, false);
  assert.equal(def.privacy.keygen, 'client');           // host-blind default
  assert.deepEqual(def.privacy.teamRecipients, []);

  assert.throws(() => validateProjectConfig({ ...base, privacy: { seal: true } }), /projectPublicKey/);
  const ok = validateProjectConfig({ ...base, privacy: { seal: true, projectPublicKey: generateProjectKeypair().publicKey } });
  assert.equal(ok.privacy.seal, true);
});

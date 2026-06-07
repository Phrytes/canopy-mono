// PR-3 wiring — cryptoForProject turns a ProjectConfig (+ whatever keys/roster this process
// holds) into the {seal, open, verify} a central pod is built with; makeCssCentralPod uses it
// so every runnable script wires privacy the same way, config-driven.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoForProject } from '../src/pod/crypto-config.js';
import { makeCssCentralPod } from '../src/pod/css-auth.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, signContribution, IdentityRoster } from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';

const cfg = (privacy) => validateProjectConfig({ projectId: 'p', llm: { route: 'local', model: 'm' }, aggregation: { k: 1 }, ...(privacy ? { privacy } : {}) });

test('cryptoForProject: capabilities follow the config + the key material present', () => {
  const k = generateProjectKeypair();
  const roster = new IdentityRoster();

  assert.deepEqual(cryptoForProject({ config: cfg() }), {});                          // privacy off → nothing

  const writer = cryptoForProject({ config: cfg({ seal: true, projectPublicKey: k.publicKey }) });
  assert.equal(typeof writer.seal, 'function'); assert.equal(writer.open, undefined);  // host-blind writer: seal, no open

  const job = cryptoForProject({ config: cfg({ seal: true, projectPublicKey: k.publicKey }), projectPrivateKey: k.privateKey });
  assert.equal(typeof job.open, 'function');                                            // aggregation has the key

  const verifying = cryptoForProject({ config: cfg({ verify: true }), roster });
  assert.equal(typeof verifying.verify, 'function');
  assert.equal(cryptoForProject({ config: cfg({ verify: true }) }).verify, undefined);  // no roster → no verifier
});

function fakeCss() {
  const store = new Map();
  const fetch = async (uri, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    if (m === 'PUT') { store.set(uri, init.body); return { ok: true, status: 201 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    const kids = [...store.keys()].filter((k) => k.startsWith(uri) && k !== uri);
    if (kids.length) return { ok: true, status: 200, json: async () => ({}), text: async () => kids.map((k) => `<${k}>`).join('\n') };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, store };
}

test('makeCssCentralPod derives seal+verify from config end-to-end', async () => {
  const key = generateProjectKeypair();
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('pa', id.publicKey, id.encPublicKey);
  const config = cfg({ seal: true, verify: true, keygen: 'host', projectPublicKey: key.publicKey });
  const css = fakeCss();
  const base = 'https://pods.example/p/central/';

  // writer: config only (seal + verify-on-write), no private key
  const writer = await makeCssCentralPod({ authedFetch: css.fetch, podBase: base, config, roster });
  const c = buildContribution({ id: 'pa:1', text: 'wachtlijst te lang' }, { lang: 'nl' });
  await writer.write('pa', c, { sig: signContribution({ projectId: 'p', participant: 'pa', contribution: c }, id.privateKey), pubKey: id.publicKey });

  // host sees ciphertext
  assert.ok([...css.store.values()].join('').includes('fp1:'));
  assert.ok(![...css.store.values()].join('').includes('wachtlijst'));

  // aggregation job: config + the private key → opens + verifies
  const job = await makeCssCentralPod({ authedFetch: css.fetch, podBase: base, config, projectPrivateKey: key.privateKey, roster });
  const agg = await job.forAggregation();
  assert.equal(agg.length, 1);
  assert.equal(agg[0].text, 'wachtlijst te lang');
});

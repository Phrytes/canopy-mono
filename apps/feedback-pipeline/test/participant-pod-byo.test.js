// M1.5 — participant-pod-first (the BYO hard invariant). The dispatcher's write target is the
// PARTICIPANT's own pod; the contribution is parked there sealed+signed, and the aggregation
// side only ever READS it via ByoCentralPod. The central never receives raw, and never holds a
// copy. Driven through the real dispatcher journey (mock LLM).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { ByoCentralPod } from '../src/pod/byo-central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair, makeSealer, makeOpener } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../src/pod/signing.js';

// an in-process stand-in for the participant's OWN pod (a CSS container they control)
function participantPod() {
  const store = new Map();
  const fetch = async (uri, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    if (m === 'PUT') { store.set(uri, init.body); return { ok: true, status: 201 }; }
    if (m === 'DELETE') { store.delete(uri); return { ok: true, status: 205 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    const kids = [...store.keys()].filter((k) => k.startsWith(uri) && k !== uri);
    if (kids.length) return { ok: true, status: 200, json: async () => ({}), text: async () => kids.map((k) => `<${k}>`).join('\n') };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, store };
}

test('BYO: consent parks sealed+signed on the participant pod; central reads via ByoCentralPod, holds nothing', async (t) => {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });

  const projectId = 'byo-m1';
  const key = generateProjectKeypair();
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('anils', id.publicKey, id.encPublicKey);
  const config = validateProjectConfig({
    projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
    privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: key.publicKey },
  });

  // the dispatcher writes to the PARTICIPANT's own pod (seal on write + verify-on-write)
  const own = participantPod();
  const podBase = 'https://pods.example/anils/feedback/';
  const writer = new CssCentralPod({
    authedFetch: own.fetch, podBase, flat: true,
    seal: makeSealer([key.publicKey]), verify: makeContributionVerifier({ roster, projectId }),
  });
  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod: writer, config, participant: 'anils', identity: id });

  await d.handleMessage('De GGZ-wachtlijst is al maanden veel te lang.');
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id));
  assert.ok(written.length >= 1, 'something was consented');

  // at rest on the participant pod: ciphertext only — central never receives raw
  const blob = [...own.store.values()].join('');
  assert.ok(blob.includes('fp1:'), 'sealed at rest on the participant pod');
  assert.ok(!blob.includes('GGZ-wachtlijst'), 'raw text never lands in cleartext');

  // the aggregation side only READS the participant pod via ByoCentralPod (holds no copy)
  const central = new ByoCentralPod({
    open: makeOpener(key.privateKey),
    verify: makeContributionVerifier({ roster, projectId }),
    sources: [{ participant: 'anils', read: async () => [...own.store.values()].map((b) => JSON.parse(b)).map((e) => ({ contribution: e.contribution, sig: e.sig, pubKey: e.pubKey })) }],
  });
  const agg = await central.forAggregation();
  assert.equal(agg.length, written.length);
  assert.equal(agg[0].user, 'anils');
  assert.match(agg[0].text, /GGZ|wachtlijst/i);   // opened + verified by the central reader
});

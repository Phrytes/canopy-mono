// M10 — full mockup project, end-to-end. A gemeente-X feedback project for N simulated
// participants, driven THROUGH the co-hosted canopy bot (InternalBusBridge + CanopyChatBot, the
// M1–M5 channel), honouring the BYO invariant (consent parks signed+sealed on each participant's
// OWN pod; the central only READS via ByoCentralPod), then k-anonymity aggregation and curator
// release → participant notify. Proves the whole composed system works as one mockup project.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InternalBus } from '../../../packages/core/src/transport/InternalTransport.js';
import { InternalBusBridge, connectFeedbackParticipant } from '../src/channel/internal-bus-bridge.js';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { ByoCentralPod } from '../src/pod/byo-central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair, makeSealer, makeOpener } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../src/pod/signing.js';
import { aggregateForProject } from '../src/run.js';
import { createCuratorWorkspace } from '../src/curator/workspace.js';
import { InMemoryNotifier } from '../src/channel/notify.js';

// an in-process stand-in for ONE participant's OWN pod (a CSS container they control).
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

test('M10 — mockup project: bot → BYO park → k-anon aggregate → curator release → notify', async (t) => {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => { if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev; await mock.close(); });

  const projectId = 'gemeente-x-wijkvernieuwing-2026';
  const key = generateProjectKeypair();
  const roster = new IdentityRoster();
  const config = validateProjectConfig({
    projectId,
    llm: { route: 'local', model: 'mock' },
    language: { preferred: 'nl' },
    aggregation: { k: 3, belowThreshold: 'quarantine' },
    privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: key.publicKey },
  });

  // 5 participants: 4 voice the SAME concern (GGZ waiting times → one theme ≥k), 1 a lone concern.
  const PEOPLE = [
    { id: 'anils', msg: 'De GGZ-wachtlijst is al maanden veel te lang.' },
    { id: 'bram',  msg: 'GGZ wachtlijst echt veel te lang zeg.' },
    { id: 'cato',  msg: 'De wachttijden bij de ggz blijven maar oplopen.' },
    { id: 'dewi',  msg: 'ggz wachtlijst is een groot probleem hier.' },
    { id: 'esra',  msg: 'het eten in de kantine is echt slecht.' },   // lone theme → below k
  ];

  const sources = [];
  for (const person of PEOPLE) {
    const idn = generateParticipantIdentity();
    roster.bind(person.id, idn.publicKey, idn.encPublicKey);

    // the participant's OWN pod (BYO): the bot writes here, sealed + verify-on-write.
    const own = participantPod();
    const writer = new CssCentralPod({
      authedFetch: own.fetch, podBase: `https://pods.example/${person.id}/feedback/`, flat: true,
      seal: makeSealer([key.publicKey]), verify: makeContributionVerifier({ roster, projectId }),
    });

    // the co-hosted bot on the participant's own bus, writing to their own pod, signing as them.
    const bus = new InternalBus();
    const bridge = new InternalBusBridge({ bus, address: 'fp-bot' });
    const bot = new CanopyChatBot({ bridge, pod: writer, config, participantFor: () => person.id, identityFor: () => idn });
    await bot.start();

    // drive the NL journey through the bot (mock intent: 'klaar'→review, 'alles'→consent_all).
    const client = connectFeedbackParticipant(bus, { chatId: person.id });
    await client.send(person.msg);
    await client.send('klaar');
    await client.send('verstuur alles');
    client.close();

    // BYO invariant: sealed at rest on the participant's own pod; raw never in cleartext.
    const blob = [...own.store.values()].join('');
    assert.ok(blob.includes('fp1:'), `${person.id}: sealed at rest on own pod`);
    assert.ok(!/wachtlijst|kantine|wachttijden/i.test(blob), `${person.id}: no raw text in cleartext`);

    // register the participant's own pod as a BYO source — the central reads, never copies.
    sources.push({
      participant: person.id,
      read: async () => [...own.store.values()].map((b) => JSON.parse(b))
        .map((e) => ({ contribution: e.contribution, sig: e.sig, pubKey: e.pubKey })),
    });
  }

  // central side: only READS the participant pods (BYO), opening + verifying each.
  const central = new ByoCentralPod({
    open: makeOpener(key.privateKey),
    verify: makeContributionVerifier({ roster, projectId }),
    sources,
  });

  // k-anonymity aggregation over the BYO sources (text already cleaned during the journey).
  const aggregate = await aggregateForProject(await central.forAggregation(), config, { skipClean: true });

  // the shared GGZ concern surfaces (≥k contributors); the lone canteen concern is quarantined.
  assert.equal(aggregate.totalUsers, 5, 'all five participants contributed');
  const surfaced = aggregate.statistical.find((s) => s.userCount >= 3);
  assert.ok(surfaced, 'the shared concern surfaced as a statistical theme (≥k)');
  assert.ok(aggregate.statistical.every((s) => s.userCount >= config.aggregation.k), 'no surfaced theme is below k');
  const quarantined = aggregate.review.find((r) => r.userCount < 3);
  assert.ok(quarantined, 'the lone below-k concern was quarantined, not surfaced');

  // curator release → participant notify (central tracks included ids; no raw leaves the pods).
  const notifier = new InMemoryNotifier();
  const ws = createCuratorWorkspace({ aggregate, pod: central, reportId: `${projectId}-2026-Q2`, notifier });
  const { report, manifest } = await ws.release({ now: '2026-06-09T12:00:00Z' });
  assert.ok(report, 'a report was published');
  assert.ok(manifest.includedContributionIds.length >= 1, 'manifest lists included contributions');

  // contributing participants received a "report-released" notification.
  const notified = PEOPLE.filter((p) => notifier.inbox(p.id).some((n) => n.type === 'report-released'));
  assert.ok(notified.length >= 1, 'release notified participants');
});

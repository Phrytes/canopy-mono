// M10 — runnable full mockup project (the manual checkpoint). A gemeente-X feedback project,
// narrated end-to-end: N participants each drive the co-hosted canopy bot (the M1–M5 channel),
// consent parks signed+sealed on their OWN pod (BYO), the central only READS via ByoCentralPod,
// k-anonymity aggregation surfaces the shared concern + quarantines the lone one, and the curator
// release notifies participants. Mirrors test/mockup-project.test.js with console narration.
//
//   node scripts/mockup-project-smoke.js   (or: npm run mockup-smoke)
//
// Self-contained: a mock LLM, in-process participant pods. Exits non-zero if any guarantee fails.

import { startMockLlm } from '../test/helpers/mock-llm.js';
import { InternalBus } from '@canopy/core';
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

const FAILS = [];
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) FAILS.push(msg); };

const mock = await startMockLlm();
process.env.FP_LLM_BASEURL = mock.url;

const projectId = 'gemeente-x-wijkvernieuwing-2026';
const key = generateProjectKeypair();
const roster = new IdentityRoster();
const config = validateProjectConfig({
  projectId, llm: { route: 'local', model: 'mock' }, language: { preferred: 'nl' },
  aggregation: { k: 3, belowThreshold: 'quarantine' },
  privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: key.publicKey },
});
console.log(`\n=== Mockup project: ${projectId} ===`);
console.log(`posture: seal + verify + BYO, k=${config.aggregation.k}, route=${config.llm.route}\n`);

const PEOPLE = [
  { id: 'anils', msg: 'De GGZ-wachtlijst is al maanden veel te lang.' },
  { id: 'bram',  msg: 'GGZ wachtlijst echt veel te lang zeg.' },
  { id: 'cato',  msg: 'De wachttijden bij de ggz blijven maar oplopen.' },
  { id: 'dewi',  msg: 'ggz wachtlijst is een groot probleem hier.' },
  { id: 'esra',  msg: 'het eten in de kantine is echt slecht.' },
];

const sources = [];
for (const person of PEOPLE) {
  const idn = generateParticipantIdentity();
  roster.bind(person.id, idn.publicKey, idn.encPublicKey);
  const own = participantPod();
  const writer = new CssCentralPod({
    authedFetch: own.fetch, podBase: `https://pods.example/${person.id}/feedback/`, flat: true,
    seal: makeSealer([key.publicKey]), verify: makeContributionVerifier({ roster, projectId }),
  });
  const bus = new InternalBus();
  const bot = new CanopyChatBot({ bridge: new InternalBusBridge({ bus, address: 'fp-bot' }), pod: writer, config, participantFor: () => person.id, identityFor: () => idn });
  await bot.start();
  const client = connectFeedbackParticipant(bus, { chatId: person.id });
  await client.send(person.msg); await client.send('klaar'); await client.send('verstuur alles');
  client.close();

  const blob = [...own.store.values()].join('');
  console.log(`• ${person.id}: "${person.msg}"`);
  check(blob.includes('fp1:') && !/wachtlijst|kantine|wachttijden/i.test(blob), `${person.id}: parked SEALED on own pod (no raw in cleartext)`);
  sources.push({ participant: person.id, read: async () => [...own.store.values()].map((b) => JSON.parse(b)).map((e) => ({ contribution: e.contribution, sig: e.sig, pubKey: e.pubKey })) });
}

const central = new ByoCentralPod({ open: makeOpener(key.privateKey), verify: makeContributionVerifier({ roster, projectId }), sources });
const aggregate = await aggregateForProject(await central.forAggregation(), config, { skipClean: true });

console.log('\n--- aggregation (k-anonymity) ---');
console.log('surfaced themes:', aggregate.statistical.map((s) => `${s.theme} (${s.userCount} users)`).join(', ') || '(none)');
console.log('quarantined:', aggregate.review.map((r) => `${r.theme} (${r.userCount})`).join(', ') || '(none)');
check(aggregate.statistical.some((s) => s.userCount >= 3), 'shared concern surfaced (≥k)');
check(aggregate.statistical.every((s) => s.userCount >= config.aggregation.k), 'no surfaced theme below k');
check(aggregate.review.some((r) => r.userCount < 3), 'lone concern quarantined (below k)');

const notifier = new InMemoryNotifier();
const ws = createCuratorWorkspace({ aggregate, pod: central, reportId: `${projectId}-2026-Q2`, notifier });
const { manifest } = await ws.release({ now: '2026-06-09T12:00:00Z' });
const notified = PEOPLE.filter((p) => notifier.inbox(p.id).some((n) => n.type === 'report-released'));
console.log('\n--- curator release ---');
console.log('included contributions:', manifest.includedContributionIds.length, '| participants notified:', notified.length);
check(manifest.includedContributionIds.length >= 1, 'report published with included contributions');
check(notified.length >= 1, 'release notified participants');

await mock.close();
console.log(`\n${FAILS.length ? `✗ ${FAILS.length} guarantee(s) FAILED` : '✓ all guarantees held — mockup project end-to-end OK'}\n`);
process.exit(FAILS.length ? 1 : 0);

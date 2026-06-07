#!/usr/bin/env node
/**
 * secure-pipeline-smoke.js — the WHOLE privacy flow end to end, config-driven, with NO
 * external deps (a fake in-process CSS + mock identities; no live CSS, no LLM). It proves the
 * runnable wiring, with ONE central pod that different processes open with different keys:
 *
 *   keygen → HI handshake (signed registration) → roster
 *   → host-blind writer: signed + SEALED writes (the pod stores only ciphertext)
 *   → a locked reader cannot aggregate; the keyed aggregation job can
 *   → a sybil is refused at the door
 *   → curator release → SEALED two-way notify → the participant opens it
 *
 *   node scripts/secure-pipeline-smoke.js
 */
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, signRegistration, verifyRegistration, signContribution, IdentityRoster } from '../src/pod/signing.js';
import { cryptoForProject } from '../src/pod/crypto-config.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { createCuratorWorkspace } from '../src/curator/workspace.js';
import { InMemoryNotifier, openNotification } from '../src/channel/notify.js';

const log = (...a) => console.log(...a);
const ok = (b) => (b ? '✓' : '✗ FAIL');

// A fake CSS shared by every capability-view below — this IS the single central pod.
function fakeCss() {
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

const css = fakeCss();
const podBase = 'https://pods.example/gemeente-x/central/';

// 1. keygen(host): the project keypair. Only the PUBLIC key goes into the config.
const projectKey = generateProjectKeypair();
const config = validateProjectConfig({
  projectId: 'gemeente-x-2026', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: projectKey.publicKey },
});
log(`\n1. keygen(host): project pubkey ${projectKey.publicKey.slice(0, 16)}…  (private key held only by the team)`);

// 2. HI handshake: real participants register signed identities (the activation service verifies
//    the proof before binding — src/activation/activate.js). A sybil never registers.
const roster = new IdentityRoster();
const people = {};
for (const name of ['anils', 'bryn']) {
  const id = generateParticipantIdentity();
  const code = `code-${name}`;
  const proof = signRegistration({ projectId: config.projectId, code, pubKey: id.publicKey, encPubKey: id.encPublicKey }, id.privateKey);
  if (!verifyRegistration({ projectId: config.projectId, code, pubKey: id.publicKey, encPubKey: id.encPublicKey }, proof)) throw new Error('proof failed');
  roster.bind(name, id.publicKey, id.encPublicKey);   // pseudonym = name (demo)
  people[name] = id;
  log(`2. registered ${name}: signing+enc keys bound to the roster (proof ${proof.slice(0, 10)}…)`);
}

// 3. host-blind writer: seal-only (public key) + verify-on-write, NO private key.
const writer = new CssCentralPod({ authedFetch: css.fetch, podBase, ...cryptoForProject({ config, roster }) });
const write = async (name, text) => {
  const c = buildContribution({ id: `${name}:1`, text }, { lang: 'nl' });
  await writer.write(name, c, { sig: signContribution({ projectId: config.projectId, participant: name, contribution: c }, people[name].privateKey), pubKey: people[name].publicKey });
};
await write('anils', 'De GGZ-wachtlijst is veel te lang.');
await write('bryn', 'Parkeren in de wijk is te duur.');
log(`\n3. two signed+sealed contributions written by the host-blind writer (no private key present)`);

let sybilRefused = false;
try {
  const sybil = generateParticipantIdentity();
  const c = buildContribution({ id: 'sybil:1', text: 'astroturf' });
  await writer.write('sybil', c, { sig: signContribution({ projectId: config.projectId, participant: 'sybil', contribution: c }, sybil.privateKey), pubKey: sybil.publicKey });
} catch { sybilRefused = true; }
log(`   sybil write refused at the door: ${ok(sybilRefused)}`);

// 4. at rest the host sees only ciphertext; a LOCKED reader (no key) cannot aggregate.
const stored = [...css.store.values()].join('');
const hostBlind = stored.includes('fp1:') && !stored.includes('GGZ') && !stored.includes('Parkeren');
log(`\n4. host sees only ciphertext at rest: ${ok(hostBlind)}`);
const locked = new CssCentralPod({ authedFetch: css.fetch, podBase, ...cryptoForProject({ config, roster }) });  // no private key
let lockedBlocked = false;
try { await locked.forAggregation(); } catch { lockedBlocked = true; }
log(`   locked reader cannot aggregate: ${ok(lockedBlocked)}`);

// 5. the keyless aggregation job runs with the unwrapped team key → open + verify the SAME pod.
const job = new CssCentralPod({ authedFetch: css.fetch, podBase, ...cryptoForProject({ config, projectPrivateKey: projectKey.privateKey, roster }) });
const forAgg = await job.forAggregation();
log(`\n5. aggregation job (with the team key) reads ${forAgg.length} verified contribution(s):`);
for (const x of forAgg) log(`     - ${x.user}: "${x.text}"`);

// 6. curator releases a report → each included participant gets a SEALED notification.
const notifier = new InMemoryNotifier({ roster });
const aggregate = {
  statistical: [{ theme: 'wachttijden & kosten', userCount: 2, messageCount: 2, summary: 'Wachtlijsten en kosten.', contributionIds: ['anils:1', 'bryn:1'] }],
  review: [], signals: [], dropped: [], rejected: [], totalUsers: 2, totalMessages: 2, lang: 'nl', kThreshold: 1,
};
await createCuratorWorkspace({ aggregate, pod: job, reportId: 'verslag-1', notifier }).release({ now: new Date().toISOString() });
const entry = notifier.inbox('anils')[0];
log(`\n6. report released; anils notified (host view is ciphertext): sealed=${ok(!!entry.sealed)}`);
const opened = openNotification(entry, people.anils.encPrivateKey);
log(`     anils opens it with her key: ${JSON.stringify(opened.payload)}`);

const allOk = sybilRefused && hostBlind && lockedBlocked && forAgg.length === 2 && opened.payload.contributionIds[0] === 'anils:1';
log(`\nall checks: ${ok(allOk)}\n`);
process.exit(allOk ? 0 : 1);

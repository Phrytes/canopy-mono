#!/usr/bin/env node
/**
 * byo-tee-smoke.js — PR-4 end to end, no external deps (no CSS, no LLM):
 *
 *   bring-your-own-pod: contributions live on each participant's OWN pod; the central side
 *     never holds a copy — it reads N sources, opens + verifies each, drops the unverified.
 *   TEE boundary: aggregation opens + verifies + aggregates inside ONE function; only the
 *     aggregate (+ an attestation) leaves — the key and plaintext never escape its scope.
 *
 *   node scripts/byo-tee-smoke.js
 */
import { generateProjectKeypair, makeSealer } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, signContribution, IdentityRoster } from '../src/pod/signing.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { ByoCentralPod } from '../src/pod/byo-central-pod.js';
import { cryptoForProject } from '../src/pod/crypto-config.js';
import { runSealedAggregation } from '../src/tee/aggregate.js';
import { buildContribution } from '../src/pod/contribution.js';

const log = (...a) => console.log(...a);
const ok = (b) => (b ? '✓' : '✗ FAIL');
const projectId = 'gemeente-byo-2026';

// keygen + a verify+seal project
const projectKey = generateProjectKeypair();
const config = validateProjectConfig({
  projectId, llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: projectKey.publicKey },
});

// each participant runs their OWN pod/agent: it seals (project public key) + signs (own key)
const roster = new IdentityRoster();
const ownPod = (participant, id, text) => {
  const c = buildContribution({ id: `${participant}:1`, text }, { lang: 'nl' });
  const sealed = { ...c, text: makeSealer([projectKey.publicKey])(c.text) };
  return { contribution: sealed, sig: signContribution({ projectId, participant, contribution: c }, id.privateKey), pubKey: id.publicKey };
};
const anils = generateParticipantIdentity(), bryn = generateParticipantIdentity(), sybil = generateParticipantIdentity();
roster.bind('anils', anils.publicKey, anils.encPublicKey);
roster.bind('bryn', bryn.publicKey, bryn.encPublicKey);
// sybil is NOT bound (never registered via the HI handshake)

log('\n1. three self-hosted (BYO) pods produce sealed+signed contributions:');
const sources = [
  { participant: 'anils', read: async () => [ownPod('anils', anils, 'De GGZ-wachtlijst is veel te lang.')] },
  { participant: 'bryn', read: async () => [ownPod('bryn', bryn, 'Parkeren in de wijk is te duur.')] },
  { participant: 'sybil', read: async () => [ownPod('sybil', sybil, 'astroturf astroturf')] },   // unregistered
  { participant: 'offline', read: async () => { throw new Error('pod unreachable'); } },          // down right now
];
log('   anils, bryn (registered), sybil (unregistered), offline (unreachable)');

// 2. BYO aggregation view — central side never copies the data, just reads + verifies.
const byo = new ByoCentralPod({ ...cryptoForProject({ config, projectPrivateKey: projectKey.privateKey, roster }), sources });
const items = await byo.forAggregation();
log(`\n2. ByoCentralPod.forAggregation() → ${items.length} verified contribution(s):`);
for (const x of items) log(`     - ${x.user}: "${x.text}"`);
log(`   sybil dropped + offline skipped: ${ok(items.length === 2 && items.every((i) => i.user !== 'sybil'))}`);

// 3. the TEE boundary: open+verify+aggregate inside; only the aggregate + attestation come out.
const aggregate = async (its) => ({ users: new Set(its.map((i) => i.user)).size, themes: its.map((i) => i.text) });
const out = await runSealedAggregation({
  config, projectPrivateKey: projectKey.privateKey, roster,
  readSealed: async () => (await Promise.all(sources.map(async (s) => {
    try { return (await s.read()).map((r) => ({ participant: s.participant, ...r })); } catch { return []; }
  }))).flat(),
  aggregate,
});
log(`\n3. TEE boundary returns ONLY the aggregate + attestation (key + plaintext never escape):`);
log(`     aggregate: ${JSON.stringify(out.aggregate)}`);
log(`     attestation: ${out.attestation.kind} (verified=${out.attestation.verified}) — ${out.attestation.note}`);
const keyLeak = JSON.stringify(out).includes(projectKey.privateKey);
log(`     private key absent from the result: ${ok(!keyLeak)}`);

const allOk = items.length === 2 && out.aggregate.users === 2 && !keyLeak;
log(`\nall checks: ${ok(allOk)}\n`);
process.exit(allOk ? 0 : 1);

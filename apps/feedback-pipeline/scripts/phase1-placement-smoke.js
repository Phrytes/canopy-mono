#!/usr/bin/env node
/**
 * phase1-placement-smoke.js — Phase 1 end to end, no external deps. Proves the team's
 * placement choice is ENFORCED, not promised:
 *
 *   • a project sets aggregation.location = 'controller'
 *   • a host-blind writer seals+signs contributions (no private key)
 *   • the PLATFORM host (FP_RUNNER_ROLE=host) literally cannot build an opener → refused
 *   • the CONTROLLER (FP_RUNNER_ROLE=controller) decrypts + aggregates on its own box
 *   • the LLM leg is routed to the local Privatemode proxy (the model never sees a host)
 *
 *   node scripts/phase1-placement-smoke.js
 */
import { validateProjectConfig } from '../src/config/project-config.js';
import { generateProjectKeypair } from '../src/pod/project-seal.js';
import { generateParticipantIdentity, signContribution, IdentityRoster } from '../src/pod/signing.js';
import { cryptoForProject } from '../src/pod/crypto-config.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { runProjectAggregation } from '../src/run.js';
import { buildContribution } from '../src/pod/contribution.js';

const log = (...a) => console.log(...a);
const ok = (b) => (b ? '✓' : '✗ FAIL');
const projectId = 'gemeente-controller-2026';

// fake CSS shared by every capability-view (the single central pod)
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

const css = fakeCss();
const base = 'https://pods.example/gemeente/central/';
const projectKey = generateProjectKeypair();

// the team chooses: decryption may happen ONLY on the controller's own infrastructure
const config = validateProjectConfig({
  projectId, llm: { route: 'privatemode', model: 'llama-3.3-70b' }, aggregation: { k: 1, location: 'controller' },
  privacy: { seal: true, verify: true, keygen: 'host', projectPublicKey: projectKey.publicKey },
});
log(`\n1. project policy: aggregation.location = "${config.aggregation.location}", llm.route = "${config.llm.route}"`);

// host-blind writer seals+signs (no private key anywhere here)
const id = generateParticipantIdentity();
const roster = new IdentityRoster();
roster.bind('anils', id.publicKey, id.encPublicKey);
const writer = new CssCentralPod({ authedFetch: css.fetch, podBase: base, ...cryptoForProject({ config, roster }) });
const c = buildContribution({ id: 'anils:1', text: 'De GGZ-wachtlijst is veel te lang.' }, { lang: 'nl' });
await writer.write('anils', c, { sig: signContribution({ projectId, participant: 'anils', contribution: c }, id.privateKey), pubKey: id.publicKey });
log('2. contribution written: sealed + signed; pod holds only ciphertext.');

// 3. the PLATFORM host tries to aggregate → refused (it can't even build an opener)
process.env.FP_RUNNER_ROLE = 'host';
let hostRefused = false;
try { new CssCentralPod({ authedFetch: css.fetch, podBase: base, ...cryptoForProject({ config, projectPrivateKey: projectKey.privateKey, roster }) }); }
catch (e) { hostRefused = /aggregation placement/.test(e.message); }
log(`\n3. platform host (FP_RUNNER_ROLE=host) attempts to decrypt: refused ${ok(hostRefused)}`);

// 4. the CONTROLLER aggregates on its own box (and routes the model to Privatemode)
process.env.FP_RUNNER_ROLE = 'controller';
const pod = new CssCentralPod({ authedFetch: css.fetch, podBase: base, ...cryptoForProject({ config, projectPrivateKey: projectKey.privateKey, roster }) });
const out = await runProjectAggregation({ pod, config, aggregate: async (items) => ({ users: new Set(items.map((i) => i.user)).size, themes: items.map((i) => i.text) }) });
log(`4. controller (FP_RUNNER_ROLE=controller) aggregates on its own infra:`);
log(`     decrypted ${out.aggregate.users} contribution(s): ${JSON.stringify(out.aggregate.themes)}`);
log(`     model leg routed to: ${out.route} (the proxy that does the TEE handshake)`);

const allOk = hostRefused && out.aggregate.users === 1 && out.location === 'controller';
log(`\nall checks: ${ok(allOk)}\n`);
process.exit(allOk ? 0 : 1);

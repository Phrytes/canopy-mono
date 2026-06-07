// End-to-end backbone smoke (Tier 1) — the single artifact that runs the WHOLE pipeline
// against a live Community Solid Server + the mock LLM:
//
//   cohort code -> activate (provision the participant's ACP container) ->
//   channel dispatcher (floor -> clean -> point list -> consent) ->
//   write to the ACP-locked container with the PARTICIPANT's own fetch ->
//   aggregation reads the central pod (owner fetch) -> Task 2 (k-anon themes)
//
// plus the consent guarantee: another participant CANNOT write your container (403).
//
//   1. start CSS with ACP:  npx @solid/community-server -p 3000 -c @css:config/file-acp.json -f ./css-data
//   2. (once)               npm i @inrupt/solid-client-authn-core
//   3.                      CSS_URL=http://localhost:3000 node scripts/e2e-smoke.js
//
// Skips cleanly (exit 0) if CSS or the auth lib is absent — a manual integration tool.

import { startMockLlm } from '../test/helpers/mock-llm.js';
import { InMemoryCohortRegistry } from '../src/activation/cohort.js';
import { activate } from '../src/activation/activate.js';
import { provisionCssPod } from '../src/activation/provision-css-pod.js';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { aggregateForProject } from '../src/run.js';
import { validateProjectConfig } from '../src/config/project-config.js';

const BASE = (process.env.CSS_URL || 'http://localhost:3000').replace(/\/$/, '');
const skip = (m) => { console.log(`SKIP: ${m}`); process.exit(0); };
try { await fetch(`${BASE}/`, { method: 'HEAD' }); } catch { skip(`no CSS at ${BASE}`); }
let authn; try { authn = await import('@inrupt/solid-client-authn-core'); } catch { skip('install @inrupt/solid-client-authn-core'); }
const { createDpopHeader, generateDpopKeyPair, buildAuthenticatedFetch } = authn;

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const uniq = (n) => `${n}${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const eq = (label, got, want) => console.log(`${got === want ? 'PASS' : 'FAIL'}  ${label} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);

async function provision(name) {
  const pn = uniq(name);
  const r = await fetch(`${BASE}/.account/account/`, { method: 'POST' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const H = { cookie, 'content-type': 'application/json' };
  const ctrl = (await j(await fetch(`${BASE}/.account/`, { headers: { cookie } }))).controls;
  await fetch(ctrl.password.create, { method: 'POST', headers: H, body: JSON.stringify({ email: `${pn}@x.c`, password: 'pw12345' }) });
  const pod = await j(await fetch(ctrl.account.pod, { method: 'POST', headers: H, body: JSON.stringify({ name: pn }) }));
  const cc = await j(await fetch(ctrl.account.clientCredentials, { method: 'POST', headers: H, body: JSON.stringify({ name: 'fp', webId: pod.webId }) }));
  const oidc = await j(await fetch(`${BASE}/.well-known/openid-configuration`));
  const dpopKey = await generateDpopKeyPair();
  const basic = Buffer.from(`${encodeURIComponent(cc.id)}:${encodeURIComponent(cc.secret)}`).toString('base64');
  const tok = await j(await fetch(oidc.token_endpoint, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', dpop: await createDpopHeader(oidc.token_endpoint, 'POST', dpopKey) }, body: 'grant_type=client_credentials&scope=webid' }));
  return { fetch: await buildAuthenticatedFetch(tok.access_token, { dpopKey }), webId: pod.webId, pod: pod.pod };
}

// ---- 0. mock LLM + project config (k=2) ----
const mock = await startMockLlm();
process.env.FP_LLM_BASEURL = mock.url;
const config = validateProjectConfig({ projectId: 'e2e', llm: { route: 'local', model: 'mock' }, aggregation: { k: 2 }, signal: { layer1OnDevice: true, escalationCategories: ['crisis'] } });

// ---- identities: owner = intermediary/aggregation; alice + bob = participants ----
const owner = await provision('project'), p1 = await provision('alice'), p2 = await provision('bob');
const centralBase = `${owner.pod}central/`;

// ---- 1. cohort + 2. activation (each activation provisions an ACP container) ----
const reg = new InMemoryCohortRegistry();
reg.registerProject({ projectId: 'e2e', expiresAt: '2026-12-31T00:00:00Z', ceiling: 10 }, 'secret');
async function onboard(label, ident) {
  const [code] = reg.generateCodes('e2e', 1);
  const res = await activate({
    registry: reg, projectId: 'e2e', code, recoveryHash: `rh-${label}`, now: '2026-06-04T00:00:00Z',
    provisionPod: () => provisionCssPod({ ownerFetch: owner.fetch, projectPodBase: owner.pod, participant: label, participantWebId: ident.webId, ownerWebId: owner.webId }),
  });
  eq(`activate ${label}`, res.ok, true);
  return res.podRef;
}
const c1 = await onboard('alice', p1);
await onboard('bob', p2);

// ---- 3. each participant: channel -> Task 1 -> consent -> write THEIR container ----
async function contribute(label, ident, msg) {
  const d = new ChannelDispatcher({ adapter: new MemoryChannelAdapter(), pod: new CssCentralPod({ authedFetch: ident.fetch, podBase: centralBase }), config, participant: label });
  await d.handleMessage(msg);
  const points = await d.review();
  const written = await d.consent(points.map((p) => p.id), { timeWindow: '2026-Q2' });
  eq(`${label} consented`, written.length, 1);
}
await contribute('alice', p1, 'De wachtlijst bij de GGZ is al maanden veel te lang.');
await contribute('bob', p2, 'GGZ wachtlijst is echt veel te lang zeg.');

// ---- 4. consent guarantee: bob cannot write alice's container ----
const intrude = await p2.fetch(`${c1}intruder.json`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
eq('bob writes alice container (denied)', intrude.status, 403);

// ---- 5. aggregation (owner reads the central pod) -> Task 2 ----
const items = await new CssCentralPod({ authedFetch: owner.fetch, podBase: centralBase }).forAggregation();
eq('aggregation participants', new Set(items.map((i) => i.user)).size, 2);
const res = await aggregateForProject(items, config, { skipClean: true });
eq('Task-2 theme at k=2', res.statistical.some((s) => s.userCount >= 2), true);
console.log('themes:', JSON.stringify(res.statistical.map((s) => ({ theme: s.theme, users: s.userCount }))));

await mock.close();
console.log('OK — full backbone end-to-end against a live CSS (cohort -> activate -> consent-write -> aggregate).');

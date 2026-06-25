#!/usr/bin/env node
// Verify-summary loop against REAL CSS pods. Proves the loop's pod persistence end-to-end on a live
// Community Solid Server + the loopback confidential proxy:
//   alice's RAW lives on HER OWN pod  →  summarise on-device (LLM via the proxy)  →  release ONLY the
//   verified summary to the CENTRAL project pod. The raw never reaches central — verified live, not asserted.
//
//   CSS_URL=http://localhost:3000 FP_LLM_BASEURL=http://localhost:8080/v1 FP_MODEL=gpt-oss-latest \
//     node scripts/verify-summary-css.js
//
// Skips cleanly (exit 0) when the CSS, the auth lib, or the proxy is unavailable.
import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { provisionCssPod } from '../src/activation/provision-css-pod.js';
import { applyLlmRoute, assertCleanRouteSafe } from '../src/ollama.js';
import { summariseOwnContributions, releaseVerifiedSummary } from '../src/verify/summary-round.js';
import { buildContribution } from '../src/pod/contribution.js';
import * as signing from '../src/pod/signing.js';

const BASE = (process.env.CSS_URL || 'http://localhost:3000').replace(/\/$/, '');
const skip = (m) => { console.log(`SKIP: ${m}`); process.exit(0); };
try { await fetch(`${BASE}/`, { method: 'HEAD' }); } catch { skip(`no CSS at ${BASE}`); }
let authn; try { authn = await import('@inrupt/solid-client-authn-core'); } catch { skip('install @inrupt/solid-client-authn-core'); }
const { createDpopHeader, generateDpopKeyPair, buildAuthenticatedFetch } = authn;
if (!process.env.FP_LLM_BASEURL) skip('set FP_LLM_BASEURL to the loopback proxy');

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const uniq = (n) => `${n}${Date.now()}${Math.floor(Math.random() * 1e5)}`;

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

// LLM route → the loopback confidential proxy (M0 safety check: only local/loopback/attested).
applyLlmRoute({ route: 'local', baseURL: process.env.FP_LLM_BASEURL });
assertCleanRouteSafe({ route: 'local', baseURL: process.env.FP_LLM_BASEURL });

// owner = the central project pod; alice = a participant with her OWN pod.
const owner = await provision('project'), alice = await provision('alice');
// containers: alice's OWN container on HER pod, and alice's container on the CENTRAL project pod.
await provisionCssPod({ ownerFetch: alice.fetch, projectPodBase: alice.pod, participant: 'alice', participantWebId: alice.webId, ownerWebId: alice.webId });
await provisionCssPod({ ownerFetch: owner.fetch, projectPodBase: owner.pod, participant: 'alice', participantWebId: alice.webId, ownerWebId: owner.webId });
const ownPod = new CssCentralPod({ authedFetch: alice.fetch, podBase: `${alice.pod}central/` });
const central = new CssCentralPod({ authedFetch: alice.fetch, podBase: `${owner.pod}central/` });

// ── Stage 1 — alice's RAW → HER OWN pod (signed). It never leaves her pod. ──────────────────────────
const id = signing.generateParticipantIdentity();
const raw = ['De GGZ-wachtlijst is al maanden veel te lang.', 'En de communicatie erover is ook slecht.'];
for (const [i, text] of raw.entries()) {
  const c = buildContribution({ id: `alice:p${i + 1}`, text }, { lang: 'nl' });
  await ownPod.write('alice', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'alice', contribution: c }));
}
console.log(`Stage 1 — alice's OWN pod (${alice.pod}central/alice/): ${(await ownPod.forAggregation()).length} raw point(s).`);

// ── Stage 2 — summarise the OWN pod on-device (proxy) → release ONLY the summary to CENTRAL. ─────────
const draft = await summariseOwnContributions({ ownPod, participant: null, model: process.env.FP_MODEL || 'gpt-oss-latest', projectId: 'demo', round: 1, opts: { lang: 'nl' } });
if (!draft.summary) skip('summarise produced no summary (proxy unreachable?)');
console.log(`\nOn-device summary (via the confidential proxy):\n  "${draft.summary}"`);
const cid = await releaseVerifiedSummary({ centralPod: central, draft, identity: id, participant: 'alice', lang: 'nl' });
console.log(`\nReleased ${cid} → the CENTRAL project pod (${owner.pod}central/alice/).`);

// ── Assertions — central holds ONLY the verified summary; raw stayed on alice's own pod. ────────────
// The central root is owner-controlled: alice WRITES her container, the OWNER aggregates (reads all).
const centralRead = new CssCentralPod({ authedFetch: owner.fetch, podBase: `${owner.pod}central/` });
const centralRecs = await centralRead.forAggregation();
const ownRecs = await ownPod.forAggregation();
const rawTexts = new Set(raw);
const leaked = centralRecs.some((r) => rawTexts.has(r.text ?? r.contribution?.text));
const onlyVerified = centralRecs.length === 1 && !leaked;
const rawStayed = ownRecs.length === raw.length;
// isolation guarantee — the project owner CANNOT read alice's own pod (the raw is hers alone).
const intrude = await owner.fetch(`${alice.pod}central/alice/`, { method: 'GET' });
const isolated = intrude.status === 401 || intrude.status === 403;

console.log('\n=== RESULT ===');
console.log(`  central project pod: ${centralRecs.length} record · alice's own pod: ${ownRecs.length} raw · raw leaked to central: ${leaked ? 'YES (LEAK!)' : 'no'}`);
console.log(`  owner reads alice's own pod → ${intrude.status} (${isolated ? 'denied ✓' : 'ALLOWED — leak!'})`);
const ok = onlyVerified && rawStayed && isolated;
console.log(ok
  ? "\n✓ verify-summary loop on REAL CSS: raw stayed on alice's own pod; only the verified summary reached central."
  : '\n✗ FAIL — an invariant broke on real pods.');
process.exit(ok ? 0 : 1);

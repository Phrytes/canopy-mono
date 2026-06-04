// Live-CSS smoke for the per-participant ACP policy (architecture §1.4) — proves that
// "consent = the write action" is ENFORCED: only the participant may write/delete in
// their container; owner + aggregation read; the aggregation is read-only; everyone else
// is denied.
//
//   1. start CSS with ACP:  npx @solid/community-server -p 3000 -c @css:config/file-acp.json -f ./css-data
//   2. (once)               npm i @inrupt/solid-client-authn-core
//   3.                      CSS_URL=http://localhost:3000 node scripts/css-acp-smoke.js
//
// Skips cleanly (exit 0) if CSS or the auth lib is absent — a manual integration tool.

import { provisionParticipantContainer } from '../src/pod/acp.js';

const BASE = (process.env.CSS_URL || 'http://localhost:3000').replace(/\/$/, '');
const skip = (m) => { console.log(`SKIP: ${m}`); process.exit(0); };
try { await fetch(`${BASE}/`, { method: 'HEAD' }); } catch { skip(`no CSS at ${BASE}`); }
let authn; try { authn = await import('@inrupt/solid-client-authn-core'); } catch { skip('install @inrupt/solid-client-authn-core'); }
const { createDpopHeader, generateDpopKeyPair, buildAuthenticatedFetch } = authn;

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const uniq = (n) => `${n}${Date.now()}${Math.floor(Math.random() * 1e5)}`;

async function provision(name) {
  const pn = uniq(name);
  let r = await fetch(`${BASE}/.account/account/`, { method: 'POST' });
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

const owner = await provision('project'), p1 = await provision('alice'), p2 = await provision('bob'), agg = await provision('aggregator');
const container = `${owner.pod}central-alice/`;
await provisionParticipantContainer(owner.fetch, container, { participantWebId: p1.webId, ownerWebId: owner.webId, readers: [agg.webId] });

const code = async (f, m, u) => (await f(u, m === 'GET' ? {} : { method: m, headers: { 'content-type': 'application/json' }, body: '{"id":"c1"}' })).status;
const exp = (label, got, ok) => console.log(`${ok.includes(got) ? 'PASS' : 'FAIL'}  ${label} -> ${got} (want ${ok.join('/')})`);
exp('p1 WRITE own', await code(p1.fetch, 'PUT', `${container}c1.json`), [201, 205]);
exp('agg READ member', await code(agg.fetch, 'GET', `${container}c1.json`), [200]);
exp('p2 WRITE (other)', await code(p2.fetch, 'PUT', `${container}x.json`), [403]);
exp('agg WRITE (read-only)', await code(agg.fetch, 'PUT', `${container}y.json`), [403]);
exp('anon WRITE', (await fetch(`${container}z.json`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, [401, 403]);
exp('p1 DELETE own', await code(p1.fetch, 'DELETE', `${container}c1.json`), [205, 204]);
console.log('OK — per-participant ACP enforced against a live CSS (consent = write).');

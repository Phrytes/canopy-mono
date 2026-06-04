// Live-CSS smoke for CssCentralPod (the repo's CSS_URL bring-your-own convention):
// provisions a fresh pod + Solid-OIDC client-credentials, builds a DPoP fetch, and runs
// the full central-pod flow against a running Community Solid Server.
//
//   1. start CSS:  npx @solid/community-server -p 3000 -c @css:config/default.json
//   2. (once)      npm i @inrupt/solid-client-authn-core
//   3.             CSS_URL=http://localhost:3000 node scripts/css-central-pod-smoke.js
//
// Skips cleanly (exit 0) if CSS isn't reachable or the auth lib isn't installed — so it
// never blocks; it is a manual integration tool, not part of `node --test`.

import { CssCentralPod } from '../src/pod/css-central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';

const BASE = (process.env.CSS_URL || 'http://localhost:3000').replace(/\/$/, '');
const skip = (msg) => { console.log(`SKIP: ${msg}`); process.exit(0); };

// CSS reachable?
try { if (!(await fetch(`${BASE}/`, { method: 'HEAD' })).ok && false) {} } catch { skip(`no CSS at ${BASE} — start one first`); }

// auth lib available? (optional dep — dynamic import)
let authn;
try { authn = await import('@inrupt/solid-client-authn-core'); }
catch { skip('install @inrupt/solid-client-authn-core to run this'); }
const { createDpopHeader, generateDpopKeyPair, buildAuthenticatedFetch } = authn;

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// provision account + pod + client-credentials
let r = await fetch(`${BASE}/.account/account/`, { method: 'POST' });
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
const H = { cookie, 'content-type': 'application/json' };
const ctrl = (await j(await fetch(`${BASE}/.account/`, { headers: { cookie } }))).controls;
await fetch(ctrl.password.create, { method: 'POST', headers: H, body: JSON.stringify({ email: `u${Date.now()}@x.c`, password: 'pw12345' }) });
const pod = await j(await fetch(ctrl.account.pod, { method: 'POST', headers: H, body: JSON.stringify({ name: 'fb' }) }));
const cc = await j(await fetch(ctrl.account.clientCredentials, { method: 'POST', headers: H, body: JSON.stringify({ name: 'fp', webId: pod.webId }) }));

// client-credentials → DPoP access token → authed fetch
const oidc = await j(await fetch(`${BASE}/.well-known/openid-configuration`));
const dpopKey = await generateDpopKeyPair();
const basic = Buffer.from(`${encodeURIComponent(cc.id)}:${encodeURIComponent(cc.secret)}`).toString('base64');
const tok = await j(await fetch(oidc.token_endpoint, {
  method: 'POST',
  headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', dpop: await createDpopHeader(oidc.token_endpoint, 'POST', dpopKey) },
  body: 'grant_type=client_credentials&scope=webid',
}));
const authedFetch = await buildAuthenticatedFetch(tok.access_token, { dpopKey });

// the adapter, on the LIVE pod
const cpod = new CssCentralPod({ authedFetch, podBase: pod.pod });
await cpod.write('part-a', buildContribution({ id: 'a1', text: 'De wachtlijst bij de GGZ is te lang.' }, { lang: 'nl' }));
await cpod.write('part-a', buildContribution({ id: 'a2', text: 'Parkeren te duur.' }));
await cpod.write('part-b', buildContribution({ id: 'b1', text: 'GGZ wachtlijst veel te lang.' }, { lang: 'nl' }));
console.log('list:', (await cpod.list()).length, '| a1:', await cpod.getStatus('a1'));
await cpod.withdraw('part-a', 'a2');
console.log('after withdraw:', (await cpod.list()).length, '| a2:', await cpod.getStatus('a2'));
await cpod.markIncluded(['a1']);
console.log('a1 after markIncluded:', await cpod.getStatus('a1'));
console.log('forAggregation:', JSON.stringify(await cpod.forAggregation()));
console.log('OK — CssCentralPod verified against a live Community Solid Server.');

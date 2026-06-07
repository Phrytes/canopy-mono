// Activation service (Tier 3a) — the HTTP front of the activation flow. A participant's app
// POSTs /activate {projectId, code, recoveryHash}; the service validates the cohort code,
// has the substrate provision the participant's ACP-locked pod container (the injected
// `provisionPod` — in production provisionCssPod), and returns the podRef. It stores only
// the amnesic recovery-hash ↔ pod-ref record (never names/identity).
//
// `provisionPod` + `registry` are injected so the core is testable with a stub; the runnable
// wiring (real CSS owner fetch + file-backed registry) is scripts/activation-service.js.

import http from 'node:http';
import { activate } from './activate.js';

/** Pure request handler — maps an activate() outcome to {status, json}. */
export async function handleActivate({ body, registry, provisionPod, config, now, onIdentity }) {
  const { projectId, code, recoveryHash, webId, pubKey, encPubKey, proof } = body || {};
  if (!projectId || !code || !recoveryHash || !webId) {
    return { status: 400, json: { ok: false, reason: 'projectId, code, recoveryHash and webId are required' } };
  }
  // The participant's client-generated webId (+ recovery hash) flow to the provisioner so
  // the ACP grants THEM write on their container (consent = the write action).
  const provision = (ctx) => provisionPod({ ...ctx, webId, recoveryHash });
  // The roster is keyed by the channel pseudonym (here: from webId, as the provisioner does).
  const bind = onIdentity ? (ctx) => onIdentity({ ...ctx, webId }) : undefined;
  let result;
  try {
    result = await activate({ registry, projectId, code, recoveryHash, now: now(), provisionPod: provision, config, pubKey, encPubKey, proof, onIdentity: bind });
  } catch (e) {
    // provisioning failed → the code is NOT spent; the participant can retry.
    return { status: 502, json: { ok: false, reason: `provisioning failed: ${e.message}` } };
  }
  if (!result.ok) return { status: 409, json: result };   // code invalid / expired / already used
  return { status: 200, json: result };                    // { ok:true, podRef }
}

/**
 * @param {object} a
 * @param {import('./cohort.js').InMemoryCohortRegistry} a.registry
 * @param {(ctx:{projectId:string,config?:object})=>Promise<{podRef:string}>} a.provisionPod
 * @param {object} [a.config]            project ProjectConfig injected at runtime
 * @param {()=>string} [a.now]           ISO timestamp source (injectable for tests)
 * @param {(registry)=>Promise<void>|void} [a.onRedeem]  persist hook, called after a successful redeem
 */
export function createActivationServer({ registry, provisionPod, config, now = () => new Date().toISOString(), onRedeem, onIdentity }) {
  return http.createServer((req, res) => {
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/activate') return send(404, { ok: false, reason: 'not found' });

    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });   // tiny payload; cap it
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, reason: 'invalid JSON' }); }
      const out = await handleActivate({ body: parsed, registry, provisionPod, config, now, onIdentity });
      if (out.status === 200 && onRedeem) { try { await onRedeem(registry); } catch { /* persistence is best-effort */ } }
      send(out.status, out.json);
    });
  });
}

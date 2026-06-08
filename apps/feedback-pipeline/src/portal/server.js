// Portal server (PR-2) — the web GUI's HTTP back end + a small JSON API over a ProjectStore.
// Project leads create a project (the menukaart), see status, and mint invite links. The
// handler is pure (handlePortal) so it is unit-testable; createPortalServer is the runnable
// http wiring (scripts/portal.js).
//
// Host keygen: when a project asks for sealing with keygen:'host' and supplies no public
// key, the server mints the project keypair, stores ONLY the public key, and returns the
// private key ONCE in the create response for the lead to save. It is never written to disk.

import http from 'node:http';
import { ProjectStore, inviteLink } from './project-store.js';
import { generateProjectKeypair } from '../pod/project-seal.js';
import { portalHtml } from './ui.js';

/** Pure API handler. @returns {{status:number, json:object}} */
export function handlePortal({ method, path, body, store, inviteBase }) {
  // POST /api/projects — create from a menukaart config + cohort window
  if (method === 'POST' && path === '/api/projects') {
    const config = body?.config || {};
    const privacy = config.privacy || {};
    let oneTimePrivateKey;
    // host keygen: mint the keypair here, persist only the public half
    if (privacy.seal && privacy.keygen === 'host' && !privacy.projectPublicKey) {
      const kp = generateProjectKeypair();
      config.privacy = { ...privacy, projectPublicKey: kp.publicKey };
      oneTimePrivateKey = kp.privateKey;
    }
    let projectId;
    try { projectId = store.createProject({ config, cohort: body?.cohort, secret: body?.secret, inviteBase: body?.inviteBase }); }
    catch (e) { return { status: 400, json: { ok: false, reason: e.message } }; }
    const out = { ok: true, projectId, status: store.status(projectId) };
    if (oneTimePrivateKey) {
      out.projectPrivateKey = oneTimePrivateKey;       // shown ONCE — the lead must save it
      out.keyNotice = 'Save this private key now — it is shown once and never stored. Aggregation needs it; lose it and the data is unrecoverable.';
    }
    return { status: 201, json: out };
  }

  // GET /api/projects — dashboard list
  if (method === 'GET' && path === '/api/projects') {
    return { status: 200, json: { ok: true, projects: store.listProjects() } };
  }

  const m = path.match(/^\/api\/projects\/([^/]+)(\/codes)?$/);
  if (m) {
    const projectId = decodeURIComponent(m[1]);
    try {
      // POST /api/projects/:id/codes — mint invite codes + links
      if (method === 'POST' && m[2] === '/codes') {
        const count = Math.max(1, Math.min(1000, Number(body?.count) || 1));
        const codes = store.generateCodes(projectId, count);
        const base = store.inviteBaseFor(projectId) || inviteBase;   // per-project, else portal default
        const links = base ? codes.map((code) => inviteLink(base, projectId, code)) : [];
        return { status: 200, json: { ok: true, projectId, codes, links } };
      }
      // GET /api/projects/:id — config + status
      if (method === 'GET' && !m[2]) {
        return { status: 200, json: { ok: true, config: store.getConfig(projectId), status: store.status(projectId) } };
      }
    } catch (e) { return { status: 404, json: { ok: false, reason: e.message } }; }
  }

  return { status: 404, json: { ok: false, reason: 'not found' } };
}

/**
 * Runnable portal http server.
 * @param {{ store:ProjectStore, inviteBase?:string, onChange?:(store)=>any }} a
 */
export function createPortalServer({ store, inviteBase, onChange }) {
  return http.createServer((req, res) => {
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(portalHtml({ inviteBase }));
    }
    if (req.method === 'GET' && path === '/health') return send(200, { ok: true });
    if (!path.startsWith('/api/')) return send(404, { ok: false, reason: 'not found' });

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1 << 20) req.destroy(); });
    req.on('end', async () => {
      let parsed = {};
      if (raw) { try { parsed = JSON.parse(raw); } catch { return send(400, { ok: false, reason: 'invalid JSON' }); } }
      const out = handlePortal({ method: req.method, path, body: parsed, store, inviteBase });
      // persist after any successful mutation
      if (out.status < 300 && (req.method === 'POST') && onChange) { try { await onChange(store); } catch { /* best-effort */ } }
      send(out.status, out.json);
    });
  });
}

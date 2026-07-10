/**
 * companion-node R3.0 — the agent-proxy NETWORK-ADVERSARY boundary, hermetic.
 *
 * R2b proved a real DELEGATION boundary (the host proves the grant was for IT,
 * from ITS owner) but enforcement stayed IN-PROCESS on the host — the host held
 * the pod client directly. R3.0 crosses the boundary R2b is not: the host runs a
 * real `PodClient`/`SolidPodSource` whose only proxied seam is `fetch`; every pod
 * HTTP request is shipped back over the REAL relay to the DELEGATING DEVICE
 * (`CapabilityAuth` mode `agent-proxy`). The device holds the pod's OIDC session
 * (DPoP minted on-device — MOCKED here) AND is the AUTHORITATIVE scope check, so
 * no pod secret ever reaches the host.
 *
 * Hermetic: the device's "authenticated fetch" is a MOCK over an in-memory pod
 * that serves LDP-container Turtle (the exact contract a real Solid pod serves,
 * so the host's Inrupt `getSolidDataset` parses it unchanged). The CSS/real-DPoP
 * proof is R3.2, NOT this slice.
 *
 * We assert RESULTS — real content / an opaque deny with NO bytes / an explicit
 * error identity — over a REAL `startRelay` + `RelayTransport`, never merely that
 * a call ran.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, Parts } from '@canopy/core';
import { VaultMemory }                 from '@canopy/vault';
import { RelayTransport }              from '@canopy/transports';

import { startCompanionNode }          from '../src/index.js';
import { buildDevPodSource }           from '../src/podSource.js';
import { authorizePod, deliverPodDelegation } from '../src/authorizePod.js';
import { registerPodProxy }            from '../src/podProxy.js';

const POD_ROOT = 'https://companion.pod.invalid/';

/* teardown registry */
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { await fn(); } catch { /* best-effort */ }
  }
});

/* ── the device's MOCK authenticated fetch over an in-memory pod ────────────── */

/** Build an LDP BasicContainer Turtle body listing `children` (absolute urls). */
function containerTurtle(containerUrl, children) {
  const head = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${containerUrl}> a ldp:Container, ldp:BasicContainer`;
  if (children.length === 0) return `${head} .\n`;
  const contains = children.map((c) => `<${c}>`).join(', ');
  return `${head} ;\n  ldp:contains ${contains} .\n`;
}

function turtleResponse(url, body) {
  const res = new Response(body, {
    status: 200, statusText: 'OK',
    headers: { 'content-type': 'text/turtle' },
  });
  try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
  return res;
}

/** Case-insensitive header lookup over a plain-object header bag. */
function headerGet(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return v;
  }
  return undefined;
}

/** Normalise a proxied request body (Uint8Array from b64decode, or string) to bytes. */
function toBytes(body) {
  if (body == null)                 return new Uint8Array();
  if (body instanceof Uint8Array)   return body;
  if (body instanceof ArrayBuffer)  return new Uint8Array(body);
  if (typeof body === 'string')     return new TextEncoder().encode(body);
  return new Uint8Array();
}

/**
 * A device-side in-memory pod + its MOCK authenticated fetch (a spy).
 *
 * `secret` is baked into the "OIDC session" the fetch closes over — it stands in
 * for the access-token / DPoP key a real device session would hold. It is NEVER
 * emitted in a response, so the NO-SECRET-ON-HOST assertion can scan the host
 * graph for it and prove it never crossed the wire.
 *
 * R3.1 — a minimal LDP-ish store that honours the FULL method set the device may
 * be asked to execute: GET/HEAD (read), PUT/POST/PATCH (write), DELETE (delete),
 * with per-resource `etag`s and faithful `If-Match` → 412 conflict semantics so a
 * stale-etag write round-trips as a real 412 back through the proxy.
 */
function makeDevicePod({ files, secret }) {
  let etagSeq = 0;
  const nextEtag = () => `"etag-${++etagSeq}"`;
  // pathname → { path, body, contentType, etag }
  const store = new Map(files.map((f) => [f.path, { ...f, etag: nextEtag() }]));
  const calls = [];                                        // spy: every fetch the DEVICE ran
  // The "session" the device would use to mint DPoP. Held ONLY here, on-device.
  const session = { accessToken: secret, dpopPrivateKey: `${secret}-dpop` };

  async function authFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method });
    // (a real device fetch would sign with `session` here — mocked)
    void session;
    const u = new URL(String(url));
    const path = u.pathname;

    // ── reads (R3.0) ────────────────────────────────────────────────────────
    if (method === 'GET' && path.endsWith('/')) {
      // Direct children of this container.
      const kids = new Set();
      for (const key of store.keys()) {
        if (!key.startsWith(path) || key === path) continue;
        const rest  = key.slice(path.length);
        const slash = rest.indexOf('/');
        kids.add(u.origin + (slash === -1 ? key : path + rest.slice(0, slash + 1)));
      }
      return turtleResponse(String(url), containerTurtle(String(url), [...kids]));
    }
    if (method === 'GET') {
      const f = store.get(path);
      if (!f) return new Response(null, { status: 404, statusText: 'Not Found' });
      const res = new Response(f.body, {
        status: 200, statusText: 'OK',
        headers: { 'content-type': f.contentType || 'application/octet-stream', etag: f.etag },
      });
      try { Object.defineProperty(res, 'url', { value: String(url) }); } catch { /* ignore */ }
      return res;
    }
    if (method === 'HEAD') {
      const f = store.get(path);
      if (!f) return new Response(null, { status: 404, statusText: 'Not Found' });
      return new Response(null, {
        status: 200, statusText: 'OK',
        headers: { 'content-type': f.contentType || 'application/octet-stream', etag: f.etag },
      });
    }

    // ── writes (R3.1) — honour the If-Match precondition → 412 on mismatch ───
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      const ifMatch = headerGet(init.headers, 'if-match');
      const cur     = store.get(path);
      if (ifMatch != null && (!cur || cur.etag !== ifMatch)) {
        return new Response(null, { status: 412, statusText: 'Precondition Failed' });
      }
      const contentType = headerGet(init.headers, 'content-type') || cur?.contentType || 'application/octet-stream';
      const etag        = nextEtag();
      store.set(path, { path, body: toBytes(init.body), contentType, etag });
      const created = !cur;
      return new Response(null, {
        status:     created ? 201 : 205,
        statusText: created ? 'Created' : 'Reset Content',
        headers:    { etag },
      });
    }

    // ── delete (R3.1) — also honours If-Match ────────────────────────────────
    if (method === 'DELETE') {
      const ifMatch = headerGet(init.headers, 'if-match');
      const cur     = store.get(path);
      if (ifMatch != null && (!cur || cur.etag !== ifMatch)) {
        return new Response(null, { status: 412, statusText: 'Precondition Failed' });
      }
      if (!cur) return new Response(null, { status: 404, statusText: 'Not Found' });
      store.delete(path);
      return new Response(null, { status: 205, statusText: 'Reset Content' });
    }

    return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
  }

  return { authFetch, calls, secret, store };
}

/* ── boot helpers ───────────────────────────────────────────────────────────── */

/** Boot an agent-proxy host: fail-closed for delegation, pod source proxied. */
async function bootProxyHost({ owner, container }) {
  // The held pod source is IRRELEVANT under agent-proxy (we replace it with a
  // proxy PodClient on delegation) — we only reuse its containerUri.
  const podSource = await buildDevPodSource({ podRoot: POD_ROOT, container, files: [] });
  const host = await startCompanionNode({
    identityVault:  new VaultMemory(),
    gate:           false,                 // isolate the pod leg from the R2 skill gate
    podProxy:       true,                  // R3.0 — agent-proxy swap on delegation
    podSource,                             // supplies containerUri
    podOwnerPubKey: owner.pubKey,          // trust root ⇒ fail-closed boot
  });
  cleanups.push(() => host.stop());
  return host;
}

/** A real device agent (== the pod owner) that also serves pod.proxyRequest. */
async function makeOwnerDevice(host, owner, devicePod) {
  const agent = new Agent({
    identity:  owner,
    transport: new RelayTransport({ relayUrl: host.relayUrl, identity: owner }),
    label:     'device',
  });
  await agent.start();
  await agent.hello(host.agent.address);
  registerPodProxy(agent, {
    authFetch:           devicePod.authFetch,
    grantIssuerIdentity: owner,                 // we honour only grants WE issued
    expectedHostPubKey:  host.agent.address,    // only that host may proxy through us
  });
  cleanups.push(() => agent.stop?.());
  return agent;
}

/** Invoke listFiles({source:'pod'}) on the host over the wire; return the reply. */
async function listPodOverWire(device, host) {
  return Parts.data(await device.invoke(host.agent.address, 'listFiles', { source: 'pod' }));
}

/** Deep-scan an object graph for a substring (proves a secret is/ isn't present). */
function graphContains(root, needle) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v == null) continue;
    if (typeof v === 'string') { if (v.includes(needle)) return true; continue; }
    if (typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const key of Object.keys(v)) {
      if (key.includes(needle)) return true;
      try { stack.push(v[key]); } catch { /* getters may throw — ignore */ }
    }
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────────── */

describe('companion-node R3.0 — agent-proxy: the network-adversary boundary (hermetic)', () => {
  it('PROXIED ALLOW: /notes/ list returns real content whose bytes transited the DEVICE fetch', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-notes',
      files: [
        { path: '/notes/welcome.md',  body: '# Welcome\n\nThis note lives in the pod.\n', contentType: 'text/markdown' },
        { path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES',                        contentType: 'image/jpeg' },
      ],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    // Deliver a /notes/ grant (owner → host).
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);

    // Spy on the host's GLOBAL fetch — the proxy must NEVER hit it for the pod.
    const realFetch = globalThis.fetch;
    const hostGlobalPodCalls = [];
    globalThis.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : input?.url;
      if (typeof u === 'string' && u.includes('companion.pod.invalid')) {
        hostGlobalPodCalls.push(u);
      }
      return realFetch(input, init);
    };

    let res;
    try {
      res = await listPodOverWire(device, host);
    } finally {
      globalThis.fetch = realFetch;
    }

    // RESULT: real pod content is returned.
    expect(res.error).toBeUndefined();
    expect(res.source).toBe('pod');
    expect(res.items.some((i) => i.name === 'welcome.md')).toBe(true);

    // The bytes transited the DEVICE's mock fetch (a GET on /notes/).
    expect(devicePod.calls.some((c) => c.method === 'GET' && c.url.endsWith('/notes/'))).toBe(true);
    // …and the host's global fetch never touched the pod.
    expect(hostGlobalPodCalls).toEqual([]);
  }, 20_000);

  it('DEVICE-AUTHORITATIVE DENY: /photos/ read is denied BY THE DEVICE — opaque, no bytes, no device fetch', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-photos',
      files: [
        { path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' },
      ],
    });
    // The host is configured to browse /photos/, but the grant only covers /notes/.
    const host   = await bootProxyHost({ owner, container: 'photos/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,   // grants /notes/, host browses /photos/
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);                        // delegation is valid + installed

    const res = await listPodOverWire(device, host);

    // Denied — no bytes, no leak of the private path/content.
    expect(res.items).toEqual([]);
    expect(res.error).toMatch(/pod list failed/i);
    expect(JSON.stringify(res)).not.toMatch(/secret\.jpg|PRIVATE-PHOTO-BYTES/);

    // Denied BY THE DEVICE: its scope-check fired BEFORE any fetch — the mock
    // authenticated fetch was NEVER called for the out-of-scope path.
    expect(devicePod.calls.some((c) => c.url.includes('/photos/'))).toBe(false);
  }, 20_000);

  it('NO SECRET ON HOST: the host graph / CapabilityAuth holds no OIDC / DPoP / access-token material', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const SECRET = 'oidc-access-SECRET-nohost';
    const devicePod = makeDevicePod({
      secret: SECRET,
      files: [{ path: '/notes/welcome.md', body: '# Welcome\n', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    await deliverPodDelegation(device, host.agent.address, token);
    // Drive one real proxied list so the credential path is fully exercised.
    const ok = await listPodOverWire(device, host);
    expect(ok.items.some((i) => i.name === 'welcome.md')).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // The device's session secret (access token / DPoP key) exists ONLY on the
    // device — it is nowhere in the host's boot graph or its pod client.
    expect(graphContains(host, SECRET)).toBe(false);
    expect(graphContains(podClient, SECRET)).toBe(false);
    // Belt-and-braces: it isn't in what the host received off the wire either.
    expect(JSON.stringify(ok)).not.toContain(SECRET);

    // The ONLY credential-shaped thing the host holds is the signed capability
    // token — a SCOPED GRANT (issuer/subject/pod/scopes/sig), not a pod secret:
    // it carries no access_token / dpop / id_token / private-key field.
    const wire = token.toJSON();
    expect(wire.issuer).toBe(owner.pubKey);
    expect(wire.subject).toBe(host.agent.address);
    expect(wire.scopes).toEqual(['pod.read:/notes/']);
    for (const forbidden of ['accessToken', 'access_token', 'dpop', 'idToken', 'id_token', 'privateKey']) {
      expect(Object.prototype.hasOwnProperty.call(wire, forbidden)).toBe(false);
    }
  }, 20_000);

  it('DEVICE-UNREACHABLE: with the device stopped, the host pod list fails with an explicit device-unreachable', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-offline',
      files: [{ path: '/notes/welcome.md', body: '# Welcome\n', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    await deliverPodDelegation(device, host.agent.address, token);

    // It works while the device is up…
    const up = await listPodOverWire(device, host);
    expect(up.items.some((i) => i.name === 'welcome.md')).toBe(true);

    // …now the device goes offline. The proxied fetch must degrade EXPLICITLY.
    await device.stop();

    const containerUri = host.store.getPodSource().containerUri;
    let caught;
    try {
      await host.store.getPodSource().podClient.list(containerUri);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(hasCauseCode(caught, 'device-unreachable')).toBe(true);
  }, 25_000);
});

/* ─────────────────────────────────────────────────────────────────────────── */

/** Install a host-global-fetch spy that records any pod-touching call. */
function spyHostGlobalPodFetch() {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input?.url;
    if (typeof u === 'string' && u.includes('companion.pod.invalid')) calls.push(u);
    return realFetch(input, init);
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const decodeBytes = (b) => new TextDecoder().decode(toBytes(b));

describe('companion-node R3.1 — agent-proxy WRITE/DELETE: the full method set over the boundary', () => {
  it('PROXIED WRITE→READ-BACK: a pod.write:/notes/ grant PUTs through the proxy; the DEVICE executes it; bytes round-trip', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-write', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/new.md`;
    const CONTENT   = '# New\n\nWritten THROUGH the agent-proxy, executed on the device.\n';

    const spy = spyHostGlobalPodFetch();
    let back;
    try {
      await podClient.write(target, CONTENT, { contentType: 'text/markdown' });
      back = await podClient.read(target, { decode: 'string' });
    } finally {
      spy.restore();
    }

    // RESULT: the bytes round-trip through the proxy write→read.
    expect(back.content).toBe(CONTENT);
    // The write transited the DEVICE's authenticated fetch as a real PUT…
    expect(devicePod.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/notes/new.md'))).toBe(true);
    // …and actually landed in the device's pod.
    expect(devicePod.store.has('/notes/new.md')).toBe(true);
    expect(decodeBytes(devicePod.store.get('/notes/new.md').body)).toBe(CONTENT);
    // The host's own global fetch never touched the pod — every byte went via the device.
    expect(spy.calls).toEqual([]);
  }, 20_000);

  it('412 CONFLICT round-trips: a stale-etag If-Match write → the device 412s → the host surfaces a ConflictError', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-412', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/race.md`;

    // First write creates the file; the host learns its etag (into its etag map).
    await podClient.write(target, 'v1', { contentType: 'text/markdown' });

    // Someone else mutates the resource out-of-band: its DEVICE-side etag advances,
    // while the host still holds the OLD etag → its next If-Match is stale.
    const cur = devicePod.store.get('/notes/race.md');
    devicePod.store.set('/notes/race.md', { ...cur, etag: '"etag-BUMPED-BY-ANOTHER-WRITER"' });

    const callsBefore = devicePod.calls.length;
    let caught;
    try {
      await podClient.write(target, 'v2', { contentType: 'text/markdown' });
    } catch (err) { caught = err; }

    // The 412 status/statusText transited the proxy faithfully → mapped to CONFLICT.
    expect(caught).toBeDefined();
    expect(caught.code).toBe('CONFLICT');            // ConflictError
    // The device DID run the (conflicting) PUT — the deny is a real HTTP 412, not a scope deny.
    expect(devicePod.calls.slice(callsBefore).some((c) => c.method === 'PUT')).toBe(true);
    // The stale write did NOT land — v1 is intact on the device.
    expect(decodeBytes(devicePod.store.get('/notes/race.md').body)).toBe('v1');
  }, 20_000);

  it('OUT-OF-SCOPE WRITE/DELETE DENIED BY THE DEVICE: a read-only token cannot PUT or DELETE — opaque, no device fetch, nothing changed', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-rodeny',
      files: [{ path: '/notes/existing.md', body: 'ORIGINAL-CONTENT', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    // READ-ONLY grant — no pod.write:, no pod.delete:.
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // PUT attempt → denied at the device (wrong ACTION: read token, write method).
    let wErr;
    try { await podClient.write(`${POD_ROOT}notes/evil.md`, 'EVIL', { contentType: 'text/markdown' }); }
    catch (e) { wErr = e; }
    expect(wErr).toBeDefined();
    expect(wErr.code).toBe('FORBIDDEN');             // opaque 403 → CapabilityError

    // DELETE attempt on an EXISTING in-container file → still denied (no delete scope).
    let dErr;
    try { await podClient.delete(`${POD_ROOT}notes/existing.md`); }
    catch (e) { dErr = e; }
    expect(dErr).toBeDefined();
    expect(dErr.code).toBe('FORBIDDEN');

    // The device NEVER executed a mutating fetch — the scope-check fired BEFORE fetch.
    expect(devicePod.calls.some((c) => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(c.method))).toBe(false);
    // Nothing was created; the existing file is byte-for-byte untouched.
    expect(devicePod.store.has('/notes/evil.md')).toBe(false);
    expect(decodeBytes(devicePod.store.get('/notes/existing.md').body)).toBe('ORIGINAL-CONTENT');
  }, 20_000);

  it('DELETE within scope removes the file; a DELETE outside scope is denied by the device', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-delete',
      files: [
        { path: '/notes/gone.md',   body: 'BYE',   contentType: 'text/markdown' },
        { path: '/photos/keep.jpg', body: 'PHOTO', contentType: 'image/jpeg' },
      ],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.delete:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // In-scope delete → the file is gone, via a real DEVICE DELETE.
    await podClient.delete(`${POD_ROOT}notes/gone.md`);
    expect(devicePod.store.has('/notes/gone.md')).toBe(false);
    expect(devicePod.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/notes/gone.md'))).toBe(true);

    // Out-of-scope delete (/photos/) → denied by the device; the file survives, no device DELETE fired.
    let err;
    try { await podClient.delete(`${POD_ROOT}photos/keep.jpg`); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('FORBIDDEN');
    expect(devicePod.store.has('/photos/keep.jpg')).toBe(true);
    expect(devicePod.calls.some((c) => c.method === 'DELETE' && c.url.includes('/photos/'))).toBe(false);
  }, 20_000);
});

/** Walk an error's `.cause` chain looking for a specific `.code`. */
function hasCauseCode(err, code) {
  let e = err;
  const seen = new Set();
  while (e && !seen.has(e)) {
    seen.add(e);
    if (e.code === code) return true;
    e = e.cause;
  }
  return false;
}

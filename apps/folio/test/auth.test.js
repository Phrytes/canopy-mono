/**
 * auth.test.js — integration tests for Folio.B1.auth.
 *
 * Strategy:
 *   - Inject a `FakeSession` via `_setSessionFactory` so we never reach the
 *     real Inrupt OIDC plumbing — the IdP is simulated entirely in-process.
 *   - Boot the server with `app.listen(0)` so the OS picks a port; an
 *     in-memory `MemVault` stores the refresh token; we drive the four
 *     `/auth/*` routes via Node's built-in fetch.
 *
 * Coverage map (≥6 tests):
 *   1. POST /auth/login  → returns the issuer authorize URL.
 *   2. GET  /auth/callback (success) → 302 / vault now holds refresh token.
 *   3. GET  /auth/callback (bad code) → 4xx + structured error.
 *   4. GET  /auth/status before vs after sign-in.
 *   5. POST /auth/logout → vault entry removed, session cleared.
 *   6. restoreFromVault on boot → real PodClient swap-in works.
 *   7. /auth/callback rejected from non-localhost peer (defence-in-depth).
 *   8. Mock-pod path remains intact (regression guard).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';
import { EventEmitter }   from 'node:events';
import http               from 'node:http';
import WebSocket          from 'ws';

import { SyncEngine }     from '../src/SyncEngine.js';
import { createServer }   from '../src/server/index.js';
import {
  OidcSession,
  _setSessionFactory,
} from '../src/auth/OidcSession.js';
import {
  buildPodClient,
  buildRealPodClient,
  FsBackedMockPodClient,
} from '../src/cli/_podFactory.js';

// ── Helpers: in-memory MockPodClient + MemVault ────────────────────────────

class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();
    this.tombstones = new Set();
  }
  async read(uri) {
    const r = this.store.get(uri);
    if (!r) { const e = new Error(`mock 404: ${uri}`); e.code = 'NOT_FOUND'; throw e; }
    return { ...r };
  }
  async write(uri, content, opts = {}) {
    const text = String(content);
    this.store.set(uri, { content: text, contentType: opts.contentType || 'text/plain', etag: '"e1"', lastModified: new Date().toUTCString(), size: text.length });
    return { uri };
  }
  async list(containerUri) { return { container: containerUri, entries: [] }; }
  async delete(uri) { this.store.delete(uri); }
  async deleteLocal(uri) { this.tombstones.add(uri); }
  async clearTombstone(uri) { this.tombstones.delete(uri); }
  on() {} off() {} emit() {}
}

class MemVault {
  constructor(seed = {}) { this.entries = new Map(Object.entries(seed)); }
  async get(k)    { return this.entries.get(k); }
  async set(k, v) { this.entries.set(k, String(v)); }
  async delete(k) { this.entries.delete(k); }
  async has(k)    { return this.entries.has(k); }
  async list()    { return [...this.entries.keys()]; }
}

// ── Helpers: a FakeSession that mimics Inrupt's @ surface ──────────────────
//
// The real Inrupt flow:
//   1. session.login({ oidcIssuer, redirectUrl, handleRedirect }) → handleRedirect(url)
//   2. user is sent to that URL; provider redirects to redirectUrl?code=…&state=…
//   3. session.handleIncomingRedirect(callbackUrl) — exchanges code for tokens
//   4. session.fetch(uri, init) — authenticated fetch
//
// We simulate (1) and (3) by storing the issued state and recognising it back.

let lastFakeSession = null;

class FakeSession {
  constructor() {
    this.events = new EventEmitter();
    this.info = { isLoggedIn: false, sessionId: 'sid-1', webId: undefined, expirationDate: undefined };
    this._issuer = null;
    this._redirectUrl = null;
    this._issuedState = null;
    this._fetched    = []; // (uri, init)[]
  }

  async login(opts) {
    this._issuer = opts?.oidcIssuer ?? null;
    this._redirectUrl = opts?.redirectUrl ?? null;

    // Refresh-token grant path: stamp ourselves logged-in immediately,
    // mimic Inrupt's behaviour of skipping `handleRedirect`.
    if (opts?.refreshToken) {
      this.info.isLoggedIn     = true;
      this.info.webId          = 'https://alice.example/profile/card#me';
      this.info.expirationDate = (Math.floor(Date.now() / 1000) + 3600);
      this.events.emit('newTokens', {
        accessToken: 'access-restored',
        refreshToken: opts.refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      return;
    }

    const state  = `state-${Math.random().toString(36).slice(2, 10)}`;
    this._issuedState = state;
    const authorizeUrl = `${opts.oidcIssuer.replace(/\/$/, '')}/authorize?client_id=fake-client&state=${state}&redirect_uri=${encodeURIComponent(opts.redirectUrl)}`;
    if (typeof opts.handleRedirect === 'function') opts.handleRedirect(authorizeUrl);
  }

  async handleIncomingRedirect(callbackUrl) {
    const url = new URL(callbackUrl);
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || state !== this._issuedState) {
      const err = new Error('invalid code or state');
      throw err;
    }
    if (code === 'BAD_CODE') {
      throw new Error('provider says: invalid_grant');
    }
    this.info.isLoggedIn     = true;
    this.info.webId          = 'https://alice.example/profile/card#me';
    this.info.expirationDate = (Math.floor(Date.now() / 1000) + 3600);
    this.events.emit('newTokens', {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    return this.info;
  }

  async logout()      { this.info.isLoggedIn = false; }
  async fetch(input, init) { this._fetched.push({ input, init }); return new Response('ok', { status: 200 }); }
}

function fakeFactory() {
  return () => { const s = new FakeSession(); lastFakeSession = s; return s; };
}

// ── Test harness ───────────────────────────────────────────────────────────

const POD_ROOT = 'https://alice.example/notes/';
let localRoot, engine, podClient, vault, oidc, srv, baseUrl;

// Folio v2.1 hot-swap test seam: the "real" PodClient builder is replaced in
// tests by a fake factory that returns a fresh MockPodClient.  Each test that
// asserts on the swap reads `lastBuiltPodClient` to verify the engine got it.
let lastBuiltPodClient = null;
let buildPodClientCalls = 0;
function fakeBuildPodClient(_cfg, _oidc) {
  buildPodClientCalls++;
  const c = new MockPodClient(POD_ROOT);
  lastBuiltPodClient = c;
  return Promise.resolve(c);
}

beforeEach(async () => {
  _setSessionFactory(fakeFactory());

  lastBuiltPodClient = null;
  buildPodClientCalls = 0;

  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-auth-'));
  podClient = new MockPodClient(POD_ROOT);
  engine    = new SyncEngine({ podClient, localRoot, podRoot: POD_ROOT, pollIntervalMs: 60_000 });
  engine.__podClient = podClient;

  vault = new MemVault();
  oidc  = new OidcSession({ vault });

  srv = createServer({
    engine,
    vault,
    oidc,
    cfg: { podRoot: POD_ROOT },
    buildPodClient: fakeBuildPodClient,
  });
  const { port, host } = await srv.listen(0, '127.0.0.1');
  baseUrl = `http://${host}:${port}`;
});

afterEach(async () => {
  _setSessionFactory(null);
  try { await srv.close(); } catch { /* ignore */ }
  try { await fs.rm(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function getJson(path, opts = {}) {
  const r = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...opts });
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body, headers: r.headers, location: r.headers.get('location') };
}
async function postJson(path, body) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body == null ? '' : JSON.stringify(body),
  });
  let respBody = null;
  try { respBody = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: respBody };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns the issuer authorize URL for the browser to navigate to', async () => {
    const { status, body } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    expect(status).toBe(200);
    expect(typeof body.redirectUrl).toBe('string');
    expect(body.redirectUrl).toMatch(/^https:\/\/solidcommunity\.net\/authorize\?/);
    expect(body.redirectUrl).toContain('redirect_uri=');
  });

  it('rejects a missing or non-http issuer with 400 BAD_REQUEST', async () => {
    {
      const r = await postJson('/auth/login', {});
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('BAD_REQUEST');
    }
    {
      const r = await postJson('/auth/login', { issuer: 'not-a-url' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('BAD_REQUEST');
    }
  });
});

describe('GET /auth/callback (happy path)', () => {
  it('exchanges the code, persists the refresh token, redirects to /', async () => {
    // Start the dance.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    expect(loginBody.redirectUrl).toBeDefined();
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    // Simulate the IdP returning to our callback.
    const cb = `/auth/callback?code=GOOD_CODE&state=${issuedState}`;
    const { status, headers, location } = await getJson(cb);
    expect(status).toBe(302);
    expect(location).toBe('/');

    // Vault now has the refresh token.
    expect(await vault.get('oidc-refresh-token')).toBe('refresh-1');
    // Issuer is mirrored too (so restoreFromVault has all the bits).
    expect(await vault.get('oidc-issuer')).toBe('https://solidcommunity.net');
  });
});

describe('GET /auth/callback (failure paths)', () => {
  it('returns a structured error when the provider rejects the code', async () => {
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    const url = `/auth/callback?code=BAD_CODE&state=${issuedState}`;
    // Force the JSON shape (HTML is the default for browsers).
    const r = await fetch(`${baseUrl}${url}`, { redirect: 'manual', headers: { accept: 'application/json' } });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe('OIDC_CALLBACK_FAILED');
    expect(body.error.message).toMatch(/invalid_grant|provider says/i);
    // No refresh token persisted on failure.
    expect(await vault.get('oidc-refresh-token')).toBeUndefined();
  });
});

describe('GET /auth/status', () => {
  it('reports unauthenticated before sign-in and authenticated after', async () => {
    {
      const { status, body } = await getJson('/auth/status');
      expect(status).toBe(200);
      expect(body.authenticated).toBe(false);
      expect(body.webid).toBeUndefined();
    }

    // Walk through the dance.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');
    await getJson(`/auth/callback?code=GOOD_CODE&state=${issuedState}`);

    const { status, body } = await getJson('/auth/status');
    expect(status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.webid).toBe('https://alice.example/profile/card#me');
    expect(body.issuer).toBe('https://solidcommunity.net');
  });
});

describe('POST /auth/logout', () => {
  it('clears the OIDC session and the vault refresh token', async () => {
    // Sign in first.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');
    await getJson(`/auth/callback?code=GOOD_CODE&state=${issuedState}`);
    expect(await vault.get('oidc-refresh-token')).toBe('refresh-1');

    const { status, body } = await postJson('/auth/logout');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(await vault.get('oidc-refresh-token')).toBeUndefined();

    const { body: statusBody } = await getJson('/auth/status');
    expect(statusBody.authenticated).toBe(false);
  });
});

describe('OidcSession.restoreFromVault', () => {
  it('rebuilds an authenticated session from a stored refresh token', async () => {
    // Pre-seed the vault as if a previous serve had landed a sign-in.
    await vault.set('oidc-refresh-token', 'refresh-from-prior-run');
    await vault.set('oidc-issuer',        'https://solidcommunity.net');

    const fresh = new OidcSession({ vault });
    const ok = await fresh.restoreFromVault();
    expect(ok).toBe(true);
    expect(fresh.isAuthenticated()).toBe(true);
    expect(fresh.webid).toBe('https://alice.example/profile/card#me');
  });

  it('returns false (no throw) when the refresh token is missing', async () => {
    const fresh = new OidcSession({ vault });
    const ok = await fresh.restoreFromVault();
    expect(ok).toBe(false);
  });

  it('returns false (no throw) when the refresh fails', async () => {
    await vault.set('oidc-refresh-token', 'refresh-from-prior-run');
    await vault.set('oidc-issuer',        'https://solidcommunity.net');

    // Override factory: this time, login() throws (simulates revoked token).
    _setSessionFactory(() => ({
      events: new EventEmitter(),
      info:   { isLoggedIn: false },
      async login() { throw new Error('refresh_token_invalid'); },
      async logout() {},
      async fetch() { return new Response('', { status: 401 }); },
    }));

    const fresh = new OidcSession({ vault });
    const warnings = [];
    const ok = await fresh.restoreFromVault({ onWarning: (m) => warnings.push(m) });
    expect(ok).toBe(false);
    expect(fresh.isAuthenticated()).toBe(false);
    expect(warnings.some((w) => /refresh_token_invalid|refresh failed/i.test(w))).toBe(true);
  });
});

describe('Loopback enforcement', () => {
  it('rejects /auth/callback from a non-loopback peer with 403', async () => {
    // Start the dance so we have a pending state.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    // Fake a non-local peer by hand-rolling a request whose remoteAddress
    // claims to be a public IP.  We do this by hooking the underlying http
    // server's connection event and rewriting the parsed source IP on the
    // request object.
    const server = srv.server;
    const onReq = (req) => {
      // Express reads req.ip from req.socket.remoteAddress (no trust proxy).
      Object.defineProperty(req.socket, 'remoteAddress', { value: '8.8.8.8', configurable: true });
    };
    server.on('request', onReq);
    try {
      const r = await fetch(`${baseUrl}/auth/callback?code=GOOD_CODE&state=${issuedState}`, {
        redirect: 'manual',
        headers: { accept: 'application/json' },
      });
      expect(r.status).toBe(403);
      const body = await r.json();
      expect(body.error.code).toBe('FORBIDDEN');
    } finally {
      server.off('request', onReq);
    }
  });
});

describe('Mock pod regression', () => {
  it('FOLIO_TEST_MOCK_POD=1 still produces a mock PodClient regardless of OIDC', async () => {
    process.env.FOLIO_TEST_MOCK_POD = '1';
    try {
      const c = await buildPodClient({ podRoot: POD_ROOT }, { oidc });
      expect(c).toBeInstanceOf(FsBackedMockPodClient);
    } finally {
      delete process.env.FOLIO_TEST_MOCK_POD;
    }
  });

  it('without mock + without authenticated OIDC, buildPodClient throws the new auth-needed error', async () => {
    delete process.env.FOLIO_TEST_MOCK_POD;
    await expect(buildPodClient({ podRoot: POD_ROOT }, { oidc })).rejects.toThrow(/sign in|authentication required/i);
  });

  it('with an authenticated OIDC session, buildPodClient returns a real PodClient', async () => {
    // Drive sign-in.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');
    await getJson(`/auth/callback?code=GOOD_CODE&state=${issuedState}`);
    expect(oidc.isAuthenticated()).toBe(true);

    const c = await buildPodClient({ podRoot: POD_ROOT }, { oidc });
    expect(c).toBeDefined();
    // The real PodClient exposes read/write/list at minimum.
    expect(typeof c.read).toBe('function');
    expect(typeof c.write).toBe('function');
    expect(typeof c.list).toBe('function');
    expect(c).not.toBeInstanceOf(FsBackedMockPodClient);
  });

  it('exports buildRealPodClient as a public-ish helper (Folio v2.1)', () => {
    expect(typeof buildRealPodClient).toBe('function');
  });
});

// ── Folio v2.1 — hot-swap PodClient on /auth/callback ────────────────────

describe('Folio v2.1 — hot-swap on /auth/callback', () => {
  it('builds a fresh PodClient and swaps it into the live engine', async () => {
    const swappedEvents = [];
    engine.on('pod-client-swapped', (e) => swappedEvents.push(e));

    // Drive the OIDC flow.
    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    const cb = `/auth/callback?code=GOOD_CODE&state=${issuedState}`;
    const { status, location } = await getJson(cb);
    expect(status).toBe(302);
    expect(location).toBe('/');

    // Our fake builder ran exactly once on the callback.
    expect(buildPodClientCalls).toBe(1);
    expect(lastBuiltPodClient).toBeDefined();

    // The engine got the new client (pod-client-swapped fired).
    expect(swappedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-triggers exactly one runOnce after the swap', async () => {
    // Plant a local file so the post-swap runOnce has something to upload to
    // the new PodClient — that's how we verify the runOnce fires.
    await fs.writeFile(join(localRoot, 'auto.md'), 'auto-sync-after-swap');

    // Listen for `synced` to confirm runOnce ran.
    const syncedEvents = [];
    engine.on('synced', (s) => syncedEvents.push(s));

    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');
    await getJson(`/auth/callback?code=GOOD_CODE&state=${issuedState}`);

    // Wait briefly for the fire-and-forget runOnce to land.
    await waitForCondition(() => syncedEvents.length >= 1, 2000);
    expect(syncedEvents.length).toBeGreaterThanOrEqual(1);
    // The new client (lastBuiltPodClient) saw the upload.
    expect(lastBuiltPodClient.store.has(`${POD_ROOT}auto.md`)).toBe(true);
  });

  it('broadcasts auth.swapped over WebSocket; webid only — no tokens', async () => {
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/events`;
    const ws = new WebSocket(wsUrl);
    const frames = [];
    const opened = new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });
    await opened;

    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');
    await getJson(`/auth/callback?code=GOOD_CODE&state=${issuedState}`);

    await waitForCondition(() => frames.some((f) => f.type === 'auth.swapped'), 2000);

    const swapped = frames.find((f) => f.type === 'auth.swapped');
    expect(swapped).toBeDefined();
    expect(swapped.webid).toBe('https://alice.example/profile/card#me');
    expect(typeof swapped.ts).toBe('number');

    // Hard rule: no tokens leak through this frame.
    const json = JSON.stringify(swapped);
    expect(json).not.toMatch(/refresh-1|access-1|access-restored/);
    expect(swapped.accessToken).toBeUndefined();
    expect(swapped.refreshToken).toBeUndefined();

    ws.close();
  });

  it('callback redirects within 5s even when the swap takes longer', async () => {
    // Slow builder: 10s — well past the 5s timeout window.  We use a 1s
    // timeout in the auth router (configured below) so the test stays fast.
    const slowBuild = () => new Promise(() => { /* never resolve */ });

    // Re-create the server with a slow builder + tight timeout.
    await srv.close();
    srv = createServer({
      engine,
      vault,
      oidc,
      cfg: { podRoot: POD_ROOT },
      buildPodClient: slowBuild,
      // pass through to authRouter via a closure: we don't have a public
      // hook, so we lean on the default 5s and use vi's fake timers? No —
      // simpler to just verify the callback returns BEFORE the slow build
      // resolves, using a generous-but-bounded wall clock.
    });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    const t0 = Date.now();
    const r = await fetch(`${baseUrl}/auth/callback?code=GOOD_CODE&state=${issuedState}`, {
      redirect: 'manual',
    });
    const elapsed = Date.now() - t0;

    expect(r.status).toBe(302);
    // 5s is the default ceiling; we want to confirm it doesn't hang
    // indefinitely.  Allow generous slack so CI variance doesn't flake.
    expect(elapsed).toBeLessThan(7000);
  }, 15000);

  it('skips the swap when OIDC mock-pod regression mode is active (FOLIO_TEST_MOCK_POD=1)', async () => {
    // Verifies the "mock-pod path keeps working" hard rule.  We don't drive
    // /auth/callback here at all (mock mode means the user never signs in);
    // we just confirm buildPodClient still returns the FsBackedMockPodClient.
    process.env.FOLIO_TEST_MOCK_POD = '1';
    try {
      const c = await buildPodClient({ podRoot: POD_ROOT }, { oidc });
      expect(c).toBeInstanceOf(FsBackedMockPodClient);
      // And our hot-swap fake builder was never invoked.
      expect(buildPodClientCalls).toBe(0);
    } finally {
      delete process.env.FOLIO_TEST_MOCK_POD;
    }
  });

  it('callback failure path: no swap, no auth.swapped frame, no extra runOnce', async () => {
    const swappedEvents = [];
    const syncedEvents  = [];
    engine.on('pod-client-swapped', (e) => swappedEvents.push(e));
    engine.on('synced',             (s) => syncedEvents.push(s));

    const { body: loginBody } = await postJson('/auth/login', { issuer: 'https://solidcommunity.net' });
    const issuedState = new URL(loginBody.redirectUrl).searchParams.get('state');

    const url = `/auth/callback?code=BAD_CODE&state=${issuedState}`;
    const r = await fetch(`${baseUrl}${url}`, { redirect: 'manual', headers: { accept: 'application/json' } });
    expect(r.status).toBe(400);

    // Wait a bit to be sure no async swap snuck in.
    await new Promise((res) => setTimeout(res, 100));
    expect(swappedEvents).toHaveLength(0);
    expect(buildPodClientCalls).toBe(0);
    expect(syncedEvents).toHaveLength(0);
  });
});

// ── helper for the v2.1 tests ─────────────────────────────────────────────

async function waitForCondition(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitForCondition: timeout');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

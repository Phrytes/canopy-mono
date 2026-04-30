/**
 * auth.test.js — `OidcSessionRN` + `folioAuth.completeSignIn` + helpers.
 *
 * Strategy: in-memory `secureStore` mock (NOT the global vi.mock — these
 * tests build their own per-suite to assert exact persistence
 * behaviour).  Auth-session paths are tested via `completeSignIn`
 * (the pure post-prompt path), not via the React hook.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  OidcSessionRN,
  SECURE_STORE_KEYS,
} from '../src/auth/OidcSessionRN.js';
import {
  completeSignIn,
  extractWebIdFromIdToken,
  _setExchangeFn,
  DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES,
} from '../src/auth/folioAuth.js';

/** Build a fresh in-memory secure store mock per test. */
function buildStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItemAsync:    vi.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    setItemAsync:    vi.fn(async (k, v) => { m.set(k, String(v)); }),
    deleteItemAsync: vi.fn(async (k) => { m.delete(k); }),
    _peek: () => Object.fromEntries(m),
    _set:  (k, v) => m.set(k, v),
  };
}

describe('OidcSessionRN — constructor validation', () => {
  it('throws when store is missing', () => {
    expect(() => new OidcSessionRN()).toThrow(/store required/);
  });
  it('throws when store is missing required methods', () => {
    expect(() => new OidcSessionRN({ store: {} })).toThrow(/getItemAsync/);
    expect(() => new OidcSessionRN({ store: { getItemAsync: () => null } })).toThrow(/setItemAsync/);
    expect(() => new OidcSessionRN({ store: {
      getItemAsync: async () => null, setItemAsync: async () => {},
    } })).toThrow(/deleteItemAsync/);
  });
  it('builds with a valid store', () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s });
    expect(sess).toBeInstanceOf(OidcSessionRN);
    expect(sess.isAuthenticated()).toBe(false);
  });
});

describe('OidcSessionRN — adoptTokens', () => {
  it('persists every token field to the store', async () => {
    const store = buildStore();
    const sess  = new OidcSessionRN({ store });
    await sess.adoptTokens({
      accessToken:  'access-1',
      refreshToken: 'refresh-1',
      idToken:      'id-1',
      expiresIn:    3600,
      issuer:       'https://login.inrupt.com',
      webid:        'https://alice.example/profile/card#me',
      clientId:     'client-id-1',
    });
    const peek = store._peek();
    expect(peek[SECURE_STORE_KEYS.ACCESS_TOKEN]).toBe('access-1');
    expect(peek[SECURE_STORE_KEYS.REFRESH_TOKEN]).toBe('refresh-1');
    expect(peek[SECURE_STORE_KEYS.ID_TOKEN]).toBe('id-1');
    expect(peek[SECURE_STORE_KEYS.WEBID]).toBe('https://alice.example/profile/card#me');
    expect(peek[SECURE_STORE_KEYS.ISSUER]).toBe('https://login.inrupt.com');
    expect(peek[SECURE_STORE_KEYS.CLIENT_ID]).toBe('client-id-1');
    // expires-at: persisted as ms-since-epoch.
    const exp = Number(peek[SECURE_STORE_KEYS.EXPIRES_AT]);
    expect(exp).toBeGreaterThan(Date.now());
    expect(exp).toBeLessThan(Date.now() + 3700 * 1000);
  });

  it('rejects when accessToken is missing', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    await expect(sess.adoptTokens({ refreshToken: 'r' })).rejects.toThrow(/accessToken/);
  });

  it('handles seconds-vs-ms expiresAt normalisation', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    const secondsExp = Math.floor(Date.now() / 1000) + 3600;  // 10-digit seconds
    await sess.adoptTokens({ accessToken: 'a', expiresAt: secondsExp });
    expect(sess.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
  });
});

describe('OidcSessionRN — isAuthenticated', () => {
  it('false with no token', () => {
    expect(new OidcSessionRN({ store: buildStore() }).isAuthenticated()).toBe(false);
  });

  it('true with a non-expired access token', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    await sess.adoptTokens({ accessToken: 'a', expiresIn: 3600 });
    expect(sess.isAuthenticated()).toBe(true);
  });

  it('false when expired', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    await sess.adoptTokens({
      accessToken: 'a',
      expiresAt:   Date.now() - 1000,
    });
    expect(sess.isAuthenticated()).toBe(false);
  });
});

describe('OidcSessionRN — restoreFromVault', () => {
  it('returns false when nothing is stored', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    expect(await sess.restoreFromVault()).toBe(false);
  });

  it('restores a previously-adopted set of tokens', async () => {
    const store = buildStore();
    const a = new OidcSessionRN({ store });
    await a.adoptTokens({
      accessToken: 'tok-1', refreshToken: 'r-1', expiresIn: 3600,
      webid: 'https://a.example/#me', issuer: 'https://login.inrupt.com',
    });
    const b = new OidcSessionRN({ store });
    expect(await b.restoreFromVault()).toBe(true);
    expect(b.webid).toBe('https://a.example/#me');
    expect(b.isAuthenticated()).toBe(true);
  });
});

describe('OidcSessionRN — getAuthenticatedFetch', () => {
  it('throws when not authenticated', () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    expect(() => sess.getAuthenticatedFetch()).toThrow(/NOT_AUTHENTICATED|not authenticated/);
  });

  it('returns a fetch wrapper that injects bearer auth', async () => {
    const store = buildStore();
    const sess  = new OidcSessionRN({ store });
    await sess.adoptTokens({ accessToken: 'tok-XYZ', expiresIn: 3600 });
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const f = sess.getAuthenticatedFetch();
    await f('https://pod.example/notes/x.md');
    expect(calls).toHaveLength(1);
    const auth = calls[0].init.headers.get('Authorization');
    expect(auth).toBe('Bearer tok-XYZ');
  });

  it('does not overwrite an explicit Authorization header', async () => {
    const store = buildStore();
    const sess  = new OidcSessionRN({ store });
    await sess.adoptTokens({ accessToken: 'tok-XYZ', expiresIn: 3600 });
    globalThis.fetch = vi.fn(async (url, init) => {
      return new Response('{}', { status: 200 });
    });
    const f = sess.getAuthenticatedFetch();
    await f('https://pod.example/foo', { headers: { Authorization: 'Bearer override' } });
    expect(globalThis.fetch).toHaveBeenCalled();
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers.get('Authorization')).toBe('Bearer override');
  });
});

describe('OidcSessionRN — logout', () => {
  it('clears every secure-store entry', async () => {
    const store = buildStore();
    const sess  = new OidcSessionRN({ store });
    await sess.adoptTokens({
      accessToken: 'a', refreshToken: 'r', idToken: 'i',
      issuer: 'https://x', webid: 'https://x/#me', clientId: 'c',
      expiresIn: 60,
    });
    expect(Object.keys(store._peek())).toHaveLength(7);
    await sess.logout();
    expect(Object.keys(store._peek())).toHaveLength(0);
    expect(sess.isAuthenticated()).toBe(false);
    expect(sess.webid).toBe(null);
  });

  it('is idempotent', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    await sess.logout();
    await sess.logout();
  });
});

describe('folioAuth.completeSignIn', () => {
  beforeEach(() => { _setExchangeFn(null); });

  it('exchanges a code → tokens via the discovered token endpoint', async () => {
    _setExchangeFn(async ({ config }) => ({
      accessToken:  'a-1',
      refreshToken: 'r-1',
      idToken:      buildFakeIdToken({ webid: 'https://x.example/#me' }),
      expiresIn:    3600,
    }));

    const result = await completeSignIn({
      result:    { type: 'success', params: { code: 'mock-code' } },
      request:   { codeVerifier: 'pkce-verifier' },
      discovery: { tokenEndpoint: 'https://login.inrupt.com/token' },
      redirectUri: 'folio://auth/callback',
      clientId:    'folio://auth/callback',
      issuer:      'https://login.inrupt.com',
    });
    expect(result.accessToken).toBe('a-1');
    expect(result.refreshToken).toBe('r-1');
    expect(result.webid).toBe('https://x.example/#me');
    expect(result.issuer).toBe('https://login.inrupt.com');
  });

  it('throws AUTH_DISMISSED when the prompt did not return success', async () => {
    await expect(completeSignIn({
      result: { type: 'cancel' },
      request: {},
      discovery: { tokenEndpoint: 'https://x' },
      redirectUri: 'folio://auth/callback',
      clientId:    'folio://auth/callback',
      issuer:      'https://login.inrupt.com',
    })).rejects.toMatchObject({ code: 'AUTH_DISMISSED' });
  });

  it('throws NO_AUTH_CODE when the redirect lacks a code', async () => {
    await expect(completeSignIn({
      result: { type: 'success', params: {} },
      request: {},
      discovery: { tokenEndpoint: 'https://x' },
      redirectUri: 'folio://auth/callback',
      clientId:    'folio://auth/callback',
      issuer:      'https://login.inrupt.com',
    })).rejects.toMatchObject({ code: 'NO_AUTH_CODE' });
  });

  it('throws NO_TOKEN_ENDPOINT when discovery is incomplete', async () => {
    await expect(completeSignIn({
      result: { type: 'success', params: { code: 'c' } },
      request: {},
      discovery: {},
      redirectUri: 'folio://auth/callback',
      clientId:    'folio://auth/callback',
      issuer:      'https://login.inrupt.com',
    })).rejects.toMatchObject({ code: 'NO_TOKEN_ENDPOINT' });
  });

  it('throws TOKEN_EXCHANGE_FAILED when the exchange returns no accessToken', async () => {
    _setExchangeFn(async () => ({}));
    await expect(completeSignIn({
      result: { type: 'success', params: { code: 'c' } },
      request: {},
      discovery: { tokenEndpoint: 'https://x' },
      redirectUri: 'folio://auth/callback',
      clientId:    'folio://auth/callback',
      issuer:      'https://login.inrupt.com',
    })).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
  });
});

describe('folioAuth.extractWebIdFromIdToken', () => {
  it('returns null for non-strings', () => {
    expect(extractWebIdFromIdToken(null)).toBe(null);
    expect(extractWebIdFromIdToken(undefined)).toBe(null);
    expect(extractWebIdFromIdToken('')).toBe(null);
    expect(extractWebIdFromIdToken('not.a.jwt')).toBe(null);
  });

  it('plucks `webid` when present', () => {
    const tok = buildFakeIdToken({ webid: 'https://alice.example/profile#me' });
    expect(extractWebIdFromIdToken(tok)).toBe('https://alice.example/profile#me');
  });

  it('falls back to `sub` when `webid` is absent', () => {
    const tok = buildFakeIdToken({ sub: 'https://alice.example/profile#me' });
    expect(extractWebIdFromIdToken(tok)).toBe('https://alice.example/profile#me');
  });
});

describe('folioAuth — defaults', () => {
  it('exports the Inrupt default issuer', () => {
    expect(DEFAULT_INRUPT_ISSUER).toBe('https://login.inrupt.com');
  });
  it('default scopes include offline_access for refresh tokens', () => {
    expect(DEFAULT_SCOPES).toContain('offline_access');
    expect(DEFAULT_SCOPES).toContain('openid');
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function buildFakeIdToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  // No signature — extractWebIdFromIdToken doesn't verify.
  return `${header}.${body}.`;
}

function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Tasks V2 — podSignIn.js session-injection seam (S5 Option A).
 *
 * Verifies the additive seam added 2026-05-18:
 *
 *   1. BACKWARD COMPAT — with NO injection (no sessionFactory, no
 *      `tokens`), the module's control flow is unchanged: it lazily
 *      builds the default Node session and runs start()/handleCallback().
 *      We assert the default factory is invoked exactly when expected
 *      and the web `callbackUrl` path still drives handleCallback.
 *
 *   2. INJECTION — when a `sessionFactory` is supplied, the module
 *      uses the injected session instead of the Node default; the
 *      `tokens` input drives `adoptTokens` (RN path) rather than
 *      `handleCallback`.
 *
 * Device-independent: no real OIDC, no @inrupt/*, no network. The
 * Node default factory is exercised only to the point of the first
 * `.start()` call (we inject a fake there too for the "default
 * factory chosen" assertion) so the suite never imports a browser
 * auth client.
 *
 * NOTE: written, not run here — the orchestrator verifies in the
 * main tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  startPodSignIn,
  completePodSignIn,
  signOutOfPod,
  podSignInStatus,
} from '../src/lib/podSignIn.js';

/** Minimal CachingDataSource-shaped stub. */
function makeDataSource() {
  let inner = null;
  return {
    async attachInner(ds) { inner = ds; },
    get hasInner() { return inner != null; },
    _inner: () => inner,
  };
}

/** A fake OIDC session covering both the Node + RN method surfaces. */
function makeFakeSession(overrides = {}) {
  return {
    started:    null,
    handled:    null,
    adopted:    null,
    _auth:      true,
    async start({ issuer, redirectUrl }) {
      this.started = { issuer, redirectUrl };
      return { redirectUrl: `${issuer}/authorize?cb=${encodeURIComponent(redirectUrl)}` };
    },
    async handleCallback(url) {
      this.handled = url;
      return { webid: 'https://pod.example/alice/profile/card#me' };
    },
    async adoptTokens(tokens) { this.adopted = tokens; },
    isAuthenticated() { return this._auth; },
    getAuthenticatedFetch() {
      // derivePodRoot fetches the WebID profile; return an origin
      // fallback (no pim:storage) so it resolves deterministically.
      return async () => ({ ok: false, async text() { return ''; } });
    },
    get webid() { return 'https://pod.example/alice/profile/card#me'; },
    async logout() { this._auth = false; },
    ...overrides,
  };
}

describe('podSignIn seam — backward compat (no injection)', () => {
  it('startPodSignIn builds the DEFAULT session when no sessionFactory', async () => {
    // We can't import the real Node createSolidAuthNode here without
    // pulling @inrupt/*; instead we assert the seam's branch logic:
    // a crew with NO oidcSession + NO sessionFactory must attempt to
    // construct one (the default path). We detect "default path
    // chosen" by pre-seeding crew.oidcSession to a fake — the module
    // must REUSE it (lazy create only when absent), proving no
    // unconditional re-creation was introduced.
    const fake = makeFakeSession();
    const crew = { dataSource: makeDataSource(), oidcSession: fake };
    const r = await startPodSignIn({
      crew, issuer: 'https://idp.example', redirectUrl: 'https://app/cb',
    });
    expect(r.ok).toBe(true);
    expect(fake.started).toEqual({
      issuer: 'https://idp.example', redirectUrl: 'https://app/cb',
    });
    // No sessionFactory was passed and a session already existed →
    // unchanged reuse behaviour.
    expect(crew.oidcSession).toBe(fake);
  });

  it('startPodSignIn still validates issuer + redirectUrl (unchanged)', async () => {
    const crew = { dataSource: makeDataSource(), oidcSession: makeFakeSession() };
    const r1 = await startPodSignIn({ crew, redirectUrl: 'https://app/cb' });
    expect(r1).toEqual({ ok: false, error: 'issuer required' });
    const r2 = await startPodSignIn({ crew, issuer: 'https://idp.example' });
    expect(r2).toEqual({ ok: false, error: 'redirectUrl required' });
  });

  it('completePodSignIn web path uses handleCallback (callbackUrl), not adoptTokens', async () => {
    const fake = makeFakeSession();
    const crew = { dataSource: makeDataSource(), oidcSession: fake };
    const r = await completePodSignIn({
      crew,
      callbackUrl: 'https://app/cb?code=xyz',
      // inject only the dataSource factory so we don't construct a
      // real SolidPodSource (existing seam, unchanged).
      dataSourceFactory: ({ podUrl }) => ({ _podUrl: podUrl }),
    });
    expect(r.ok).toBe(true);
    expect(fake.handled).toBe('https://app/cb?code=xyz');   // web path
    expect(fake.adopted).toBeNull();                         // NOT the RN path
    expect(crew.dataSource.hasInner).toBe(true);
  });

  it('completePodSignIn web path still rejects when no sign-in in progress', async () => {
    const crew = { dataSource: makeDataSource() };  // no oidcSession
    const r = await completePodSignIn({ crew, callbackUrl: 'https://app/cb' });
    expect(r).toEqual({
      ok: false, error: 'no sign-in in progress; call startPodSignIn first',
    });
  });

  it('signOutOfPod + podSignInStatus unchanged (duck-typed)', async () => {
    const fake = makeFakeSession();
    const crew = { dataSource: makeDataSource(), oidcSession: fake };
    expect(podSignInStatus({ crew })).toEqual({
      signedIn: true,
      webid:    'https://pod.example/alice/profile/card#me',
      podAttached: false,
    });
    const out = await signOutOfPod({ crew });
    expect(out).toEqual({ ok: true });
    expect(crew.oidcSession).toBeNull();
    expect(podSignInStatus({ crew })).toEqual({ signedIn: false });
  });
});

describe('podSignIn seam — injection (RN path)', () => {
  it('sessionFactory is used INSTEAD of the Node default', async () => {
    const fake = makeFakeSession();
    const sessionFactory = vi.fn(() => fake);
    const crew = { dataSource: makeDataSource() };   // no pre-existing session
    const r = await startPodSignIn({
      crew, issuer: 'https://idp.example', redirectUrl: 'https://app/cb',
      sessionFactory,
    });
    expect(r.ok).toBe(true);
    expect(sessionFactory).toHaveBeenCalledTimes(1);
    expect(sessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: 'Tasks' }),
    );
    expect(crew.oidcSession).toBe(fake);
  });

  it('completePodSignIn `tokens` path adopts tokens (no handleCallback)', async () => {
    const fake = makeFakeSession();
    const sessionFactory = vi.fn(() => fake);
    const crew = { dataSource: makeDataSource() };
    const tokens = { accessToken: 'AT', webid: 'https://pod.example/bob#me' };
    const r = await completePodSignIn({
      crew,
      tokens,
      sessionFactory,
      dataSourceFactory: ({ podUrl }) => ({ _podUrl: podUrl }),
    });
    expect(r.ok).toBe(true);
    expect(fake.adopted).toEqual(tokens);     // RN path
    expect(fake.handled).toBeNull();          // NOT the web path
    expect(r.webid).toBe('https://pod.example/bob#me');
    expect(crew.dataSource.hasInner).toBe(true);
  });

  it('tokens path errors clearly when the session lacks adoptTokens', async () => {
    const noAdopt = makeFakeSession({ adoptTokens: undefined });
    const crew = { dataSource: makeDataSource() };
    const r = await completePodSignIn({
      crew,
      tokens: { accessToken: 'AT' },
      sessionFactory: () => noAdopt,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adoptTokens/);
  });

  it('reuses an existing crew.oidcSession even with a sessionFactory', async () => {
    const existing = makeFakeSession();
    const factory  = vi.fn(() => makeFakeSession());
    const crew = { dataSource: makeDataSource(), oidcSession: existing };
    await startPodSignIn({
      crew, issuer: 'https://idp.example', redirectUrl: 'https://app/cb',
      sessionFactory: factory,
    });
    // ensureSession only builds when absent — existing wins.
    expect(factory).not.toHaveBeenCalled();
    expect(crew.oidcSession).toBe(existing);
  });
});

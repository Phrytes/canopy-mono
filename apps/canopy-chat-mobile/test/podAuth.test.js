/**
 * Bundle F P6 — mobile podAuth adapter contract (#262).
 *
 * Pins the shape that buildMobilePodAuth exposes — same surface
 * web's @canopy/oidc-session has, so localBuiltins' signin /
 * signout / whoami handlers work without per-surface branching.
 */
import { describe, it, expect } from 'vitest';
import { buildMobilePodAuth } from '../src/core/podAuth.js';

function fakeSession({ webid = null, authed = false, accessToken = null } = {}) {
  let cleared = false;
  return {
    isAuthenticated: () => authed && !cleared,
    get webid()        { return cleared ? null : webid; },
    get accessToken()  { return cleared ? null : accessToken; },
    get clientId()     { return null; },
    getStatus: () => ({ authenticated: authed && !cleared, webid: webid ?? undefined }),
    clear: async () => { cleared = true; },
  };
}

function fakeHook({ signInResult = { type: 'cancel' } } = {}) {
  const calls = [];
  return {
    ready: true,
    lastError: null,
    signIn: async (args) => {
      calls.push(args);
      return signInResult;
    },
    _calls: calls,
  };
}

describe('Bundle F P6 — buildMobilePodAuth', () => {
  it('exposes the podAuth interface localBuiltins.signin expects', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession(),
    });
    expect(typeof pa.startSignIn).toBe('function');
    expect(typeof pa.resolveIssuer).toBe('function');
    expect(typeof pa.getCurrentSession).toBe('function');
    expect(typeof pa.getRawSessionInfo).toBe('function');
    expect(typeof pa.signOut).toBe('function');
  });

  it('resolveIssuer returns the default issuer when input is empty', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession() });
    const r = pa.resolveIssuer('');
    expect(r).toBeTruthy();
    expect(typeof r.url).toBe('string');
  });

  it('resolveIssuer returns null for unknown input', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession() });
    expect(pa.resolveIssuer('totally-unknown-issuer')).toBeNull();
  });

  it('getCurrentSession returns null when session is not authenticated', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession({ authed: false }) });
    expect(pa.getCurrentSession()).toBeNull();
  });

  it('getCurrentSession returns {webid} when session has stored tokens', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession({
        webid: 'https://alice.solid.example/profile/card#me',
        authed: true,
        accessToken: 'tok',
      }),
    });
    expect(pa.getCurrentSession()).toEqual({
      webid: 'https://alice.solid.example/profile/card#me',
    });
  });

  it('getRawSessionInfo exposes the diagnostic shape /whoami needs', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession({ accessToken: 'tok' }),
    });
    const info = pa.getRawSessionInfo();
    expect(info).toHaveProperty('sessionExists');
    expect(info).toHaveProperty('isLoggedIn');
    expect(info).toHaveProperty('webId');
  });

  it('signOut clears the underlying session', async () => {
    const session = fakeSession({ webid: 'https://x/#me', authed: true, accessToken: 'tok' });
    const pa = buildMobilePodAuth({ hook: fakeHook(), session });
    expect(pa.getCurrentSession()).toBeTruthy();
    await pa.signOut();
    expect(pa.getCurrentSession()).toBeNull();
  });

  // ⚠️ KNOWN-FAILING — DEFERRED (recorded REMAINING-WORK.md §M test-hygiene, 2026-07-05).
  // NOT a §1b regression (pod/OIDC sign-in is untouched by that work). The mocked `startSignIn` hook isn't
  // adopting the token (`adopted` stays undefined, expected 'AT') — a mock/hook-wiring mismatch in the vitest
  // harness (this differs from an assertion about real product behaviour; real interactive sign-in is verified
  // separately with creds, #167/#262). Loosely adjacent to the oidc-session/vault de-fuzz in
  // plans/design/DESIGN-layered-architecture-model.md (runtime-foundation layering), but this failure is
  // harness-shaped, not the inversion. DEFERRED: revisit with the oidc de-fuzz OR when the paused mobile-pod
  // work resumes. NB: unlike the other two deferred reds, this one *could* be a real break in buildMobilePodAuth
  // rather than pure harness — worth a ~10-min confirm (harness-vs-real) before the oidc work.
  it('startSignIn calls the hook and adopts tokens on success', async () => {
    const hook = fakeHook({
      signInResult: {
        type: 'success',
        tokens: {
          accessToken: 'AT',
          refreshToken: 'RT',
          webid: 'https://alice.solid.example/profile/card#me',
        },
      },
    });
    let adopted = null;
    const session = {
      ...fakeSession(),
      adoptTokens: async (tokens) => { adopted = tokens; },
    };
    const pa = buildMobilePodAuth({ hook, session });
    await pa.startSignIn({});
    expect(hook._calls).toHaveLength(1);
    expect(adopted?.accessToken).toBe('AT');
    expect(adopted?.webid).toBe('https://alice.solid.example/profile/card#me');
  });
});

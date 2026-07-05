import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AgentIdentity, PodCapabilityToken } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import {
  AuthError,
  CapabilityAuth,
  SolidOidcAuth,
} from '../src/index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function makeIdentity() {
  return AgentIdentity.generate(new VaultMemory());
}

/** Build a fresh, valid token issued by `issuer` to `subject.pubKey`. */
async function makeValidToken(issuer, subject, overrides = {}) {
  return PodCapabilityToken.issue(issuer, {
    subject:   subject.pubKey,
    pod:       'https://alice.example/pod/',
    scopes:    ['pod.read:/inbox/', 'pod.write:/outbox/'],
    expiresIn: 60_000,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* CapabilityAuth                                                             */
/* -------------------------------------------------------------------------- */

describe('CapabilityAuth', () => {
  let issuer;
  let subject;

  beforeEach(async () => {
    issuer  = await makeIdentity();
    subject = await makeIdentity();
  });

  it('constructor: valid token + mode "pod-direct" succeeds', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token, mode: 'pod-direct' });
    expect(auth.mode).toBe('pod-direct');
  });

  it('getAuthHeaders returns Authorization Bearer with the serialized token JSON', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token, mode: 'pod-direct' });

    const headers = await auth.getAuthHeaders('/x', 'GET');
    expect(headers).toHaveProperty('Authorization');
    expect(headers.Authorization).toMatch(/^Bearer /);

    const serialized = headers.Authorization.slice('Bearer '.length);
    const parsed     = JSON.parse(serialized);
    expect(parsed.id).toBe(token.id);
    expect(parsed.subject).toBe(subject.pubKey);
    expect(parsed.issuer).toBe(issuer.pubKey);
    expect(parsed.pod).toBe('https://alice.example/pod/');
    expect(parsed.sig).toBe(token.toJSON().sig);
  });

  it('invalid mode "agent-proxy" throws AuthError with AUTH_MODE_NOT_SUPPORTED', async () => {
    const token = await makeValidToken(issuer, subject);
    let caught;
    try { new CapabilityAuth({ token, mode: 'agent-proxy' }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('AUTH_MODE_NOT_SUPPORTED');
  });

  it('missing mode throws AuthError with AUTH_MODE_NOT_SUPPORTED', async () => {
    const token = await makeValidToken(issuer, subject);
    let caught;
    try { new CapabilityAuth({ token }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('AUTH_MODE_NOT_SUPPORTED');
  });

  it('missing token throws AuthError with INVALID_TOKEN', async () => {
    let caught;
    try { new CapabilityAuth({ mode: 'pod-direct' }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('INVALID_TOKEN');
  });

  it('tampered token (subject swapped) throws AuthError with INVALID_TOKEN', async () => {
    const other = await makeIdentity();
    const token = await makeValidToken(issuer, subject);

    // Mutate JSON form to flip subject — signature no longer valid.
    const tampered    = token.toJSON();
    tampered.subject  = other.pubKey;

    let caught;
    try { new CapabilityAuth({ token: tampered, mode: 'pod-direct' }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('INVALID_TOKEN');
  });

  it('expired token throws AuthError with TOKEN_EXPIRED', async () => {
    const token = await makeValidToken(issuer, subject, { expiresIn: -1000 });
    let caught;
    try { new CapabilityAuth({ token, mode: 'pod-direct' }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('TOKEN_EXPIRED');
  });

  it('accepts a token JSON string', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token: token.toString(), mode: 'pod-direct' });
    expect(auth.identity()).toBe(subject.pubKey);
  });

  it('identity() returns the token subject', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token, mode: 'pod-direct' });
    expect(auth.identity()).toBe(subject.pubKey);
  });

  it('after close(), getAuthHeaders + identity throw INVALID_TOKEN', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token, mode: 'pod-direct' });

    await auth.close();

    await expect(auth.getAuthHeaders('/x', 'GET')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'INVALID_TOKEN',
    });
    expect(() => auth.identity()).toThrowError(
      expect.objectContaining({ name: 'AuthError', code: 'INVALID_TOKEN' }),
    );
  });

  it('close() is idempotent', async () => {
    const token = await makeValidToken(issuer, subject);
    const auth  = new CapabilityAuth({ token, mode: 'pod-direct' });
    await auth.close();
    await expect(auth.close()).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* SolidOidcAuth                                                              */
/* -------------------------------------------------------------------------- */

describe('SolidOidcAuth', () => {
  const WEBID = 'https://alice.example/profile/card#me';

  function makeStubVault({
    webid          = WEBID,
    fetchImpl      = vi.fn(),
    refreshImpl    = vi.fn(async () => {}),
    logoutImpl     = vi.fn(async () => {}),
  } = {}) {
    return {
      webid,
      getAuthenticatedFetch: vi.fn(() => fetchImpl),
      refresh:               refreshImpl,
      logout:                logoutImpl,
      _fetchImpl:            fetchImpl, // exposed for assertions
    };
  }

  it('constructor: valid stub vault succeeds', () => {
    const vault = makeStubVault();
    expect(() => new SolidOidcAuth({ vault })).not.toThrow();
  });

  it('constructor: no opts throws AuthError with INVALID_AUTH_ARGS', () => {
    let caught;
    try { new SolidOidcAuth(); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('INVALID_AUTH_ARGS');
  });

  it('constructor: missing vault throws AuthError with INVALID_AUTH_ARGS', () => {
    let caught;
    try { new SolidOidcAuth({}); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('INVALID_AUTH_ARGS');
  });

  it('constructor: vault missing getAuthenticatedFetch throws INVALID_AUTH_ARGS', () => {
    const vault = { webid: WEBID }; // no getAuthenticatedFetch
    let caught;
    try { new SolidOidcAuth({ vault }); }
    catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(AuthError);
    expect(caught.code).toBe('INVALID_AUTH_ARGS');
  });

  it('getAuthenticatedFetch() returns the vault\'s fetch and calls through', () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });

    const got = auth.getAuthenticatedFetch();
    expect(got).toBe(vault._fetchImpl);
    expect(vault.getAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('getAuthHeaders throws AuthError with AUTH_USE_AUTHENTICATED_FETCH', async () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });

    await expect(auth.getAuthHeaders('/x', 'GET')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'AUTH_USE_AUTHENTICATED_FETCH',
    });
  });

  it('identity() returns the WebID', () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });
    expect(auth.identity()).toBe(WEBID);
  });

  it('refresh() delegates to vault.refresh', async () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });
    await auth.refresh();
    expect(vault.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh() is a no-op when vault has no refresh()', async () => {
    const vault = {
      webid: WEBID,
      getAuthenticatedFetch: vi.fn(() => vi.fn()),
      // no refresh, no logout
    };
    const auth = new SolidOidcAuth({ vault });
    await expect(auth.refresh()).resolves.toBeUndefined();
  });

  it('close() calls vault.logout once; second close() is a no-op', async () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });

    await auth.close();
    await auth.close();

    expect(vault.logout).toHaveBeenCalledTimes(1);
  });

  it('close() swallows logout errors', async () => {
    const vault = makeStubVault({
      logoutImpl: vi.fn(async () => { throw new Error('network blip'); }),
    });
    const auth = new SolidOidcAuth({ vault });
    await expect(auth.close()).resolves.toBeUndefined();
    expect(vault.logout).toHaveBeenCalledTimes(1);
  });

  it('after close(), getAuthenticatedFetch + identity throw AUTH_CLOSED', async () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });
    await auth.close();

    expect(() => auth.getAuthenticatedFetch()).toThrowError(
      expect.objectContaining({ name: 'AuthError', code: 'AUTH_CLOSED' }),
    );
    expect(() => auth.identity()).toThrowError(
      expect.objectContaining({ name: 'AuthError', code: 'AUTH_CLOSED' }),
    );
  });

  it('after close(), refresh() is a silent no-op (does not call vault.refresh)', async () => {
    const vault = makeStubVault();
    const auth  = new SolidOidcAuth({ vault });
    await auth.close();
    await auth.refresh();
    expect(vault.refresh).not.toHaveBeenCalled();
  });
});

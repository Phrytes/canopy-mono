/**
 * OAuthVault.test.js — Track F / F1 unit tests.
 *
 * Covers Q-F.1 (multi-account + default fallback) and Q-F.2 (proactive
 * near-expiry refresh + reactive 401 retry + in-flight coalescing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VaultMemory } from '../../src/identity/VaultMemory.js';
import {
  OAuthVault,
  makeAuthorizedFetch,
} from '../../src/identity/OAuthVault.js';

// Helper: build a fresh OAuthVault on top of a memory vault.
function makeVault() {
  const vault = new VaultMemory();
  return { vault, oauth: new OAuthVault({ vault }) };
}

describe('OAuthVault — construction', () => {
  it('throws if no underlying vault provided', () => {
    expect(() => new OAuthVault()).toThrow(/vault/);
    expect(() => new OAuthVault({})).toThrow(/vault/);
  });
});

describe('OAuthVault — multi-account storage (Q-F.1)', () => {
  it('stores tokens for the same service under separate accountIds', async () => {
    const { oauth } = makeVault();

    await oauth.storeTokens('google', 'alice@personal.com', {
      access: 'A-personal', refresh: 'R-personal',
    });
    await oauth.storeTokens('google', 'alice@work.org', {
      access: 'A-work', refresh: 'R-work',
    });

    const personal = await oauth.getTokens('google', 'alice@personal.com');
    const work     = await oauth.getTokens('google', 'alice@work.org');

    expect(personal.access).toBe('A-personal');
    expect(work.access).toBe('A-work');
  });

  it('default-account fallback: storeTokens(svc, null, ...) + getTokens(svc) round-trips', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, { access: 'A1', refresh: 'R1' });

    const got = await oauth.getTokens('google');
    expect(got).toEqual({ access: 'A1', refresh: 'R1' });
  });

  it('listAccounts returns all known accountIds for the service', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null,                  { access: 'a' });
    await oauth.storeTokens('google', 'alice@personal.com',  { access: 'b' });
    await oauth.storeTokens('google', 'alice@work.org',      { access: 'c' });
    // a token for a *different* service must not leak in
    await oauth.storeTokens('notion', 'team-a',              { access: 'd' });

    const accounts = await oauth.listAccounts('google');
    expect(accounts.sort()).toEqual(
      ['default', 'alice@personal.com', 'alice@work.org'].sort(),
    );
    const notionAccounts = await oauth.listAccounts('notion');
    expect(notionAccounts).toEqual(['team-a']);
  });

  it('returns null when no tokens stored', async () => {
    const { oauth } = makeVault();
    expect(await oauth.getTokens('google')).toBeNull();
    expect(await oauth.getTokens('google', 'unknown@example.com')).toBeNull();
  });

  it('storeTokens rejects bundles without an access token', async () => {
    const { oauth } = makeVault();
    await expect(oauth.storeTokens('google', null, { refresh: 'R' }))
      .rejects.toThrow(/access/);
  });
});

describe('OAuthVault — proactive refresh (Q-F.2)', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('refreshes when the access token is within the 60s buffer', async () => {
    const { oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({
      access: 'A-NEW', refresh: 'R-NEW', expiresAt: Date.now() + 3_600_000,
    }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() + 30_000,         // 30s away → within buffer
    });

    const got = await oauth.getTokens('google');
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledWith('R-OLD', undefined);
    expect(got.access).toBe('A-NEW');
    expect(got.refresh).toBe('R-NEW');
  });

  it('does NOT refresh when the access token is fresh', async () => {
    const { oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({ access: 'A-NEW' }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() + 600_000,        // 10 min → fresh
    });

    const got = await oauth.getTokens('google');
    expect(refreshFn).not.toHaveBeenCalled();
    expect(got.access).toBe('A-OLD');
  });

  it('does NOT refresh when bundle has no expiresAt (treated as fresh)', async () => {
    const { oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({ access: 'A-NEW' }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
    });

    const got = await oauth.getTokens('google');
    expect(refreshFn).not.toHaveBeenCalled();
    expect(got.access).toBe('A-OLD');
  });

  it('without refresh fn registered, returns the stale bundle as-is', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() - 5_000,          // already expired
    });

    const got = await oauth.getTokens('google');
    // No refresh fn → return as-is; caller will see 401 and trigger reactive path.
    expect(got.access).toBe('A-OLD');
  });

  it('without refresh token, returns the stale bundle as-is even if a refresh fn exists', async () => {
    const { oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({ access: 'A-NEW' }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD',
      expiresAt: Date.now() - 5_000,
    });

    const got = await oauth.getTokens('google');
    expect(refreshFn).not.toHaveBeenCalled();
    expect(got.access).toBe('A-OLD');
  });

  it('refreshTokens() forces a refresh and persists the new bundle', async () => {
    const { vault, oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({
      access: 'A-NEW', refresh: 'R-NEW', expiresAt: Date.now() + 3_600_000,
    }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() + 600_000,        // fresh — but we force
    });

    const fresh = await oauth.refreshTokens('google');
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(fresh.access).toBe('A-NEW');

    const persisted = JSON.parse(await vault.get('oauth:google:default'));
    expect(persisted.access).toBe('A-NEW');
    expect(persisted.refresh).toBe('R-NEW');
  });

  it('refreshTokens() throws OAUTH_NO_TOKENS if nothing stored', async () => {
    const { oauth } = makeVault();
    oauth.registerRefreshFn('google', vi.fn());
    await expect(oauth.refreshTokens('google'))
      .rejects.toMatchObject({ code: 'OAUTH_NO_TOKENS' });
  });

  it('refreshTokens() throws OAUTH_NO_REFRESH_TOKEN when bundle has no refresh field', async () => {
    const { oauth } = makeVault();
    oauth.registerRefreshFn('google', vi.fn());
    await oauth.storeTokens('google', null, { access: 'A' });
    await expect(oauth.refreshTokens('google'))
      .rejects.toMatchObject({ code: 'OAUTH_NO_REFRESH_TOKEN' });
  });

  it('refreshTokens() throws OAUTH_NO_REFRESH_FN if no refresh fn registered', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, { access: 'A', refresh: 'R' });
    await expect(oauth.refreshTokens('google'))
      .rejects.toMatchObject({ code: 'OAUTH_NO_REFRESH_FN' });
  });
});

describe('OAuthVault — in-flight refresh coalescing (Q-F.2)', () => {
  it('two concurrent expired getTokens calls trigger only ONE refresh', async () => {
    const { oauth } = makeVault();

    let resolveRefresh;
    const refreshFn = vi.fn(() => new Promise((resolve) => {
      resolveRefresh = () => resolve({
        access: 'A-NEW', refresh: 'R-NEW', expiresAt: Date.now() + 3_600_000,
      });
    }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() + 10_000,
    });

    const p1 = oauth.getTokens('google');
    const p2 = oauth.getTokens('google');

    // Allow the first call's vault.get + the in-flight write to settle, then
    // resolve the refresh fn.  Both promises must observe the same fresh bundle.
    await Promise.resolve();
    resolveRefresh();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(r1.access).toBe('A-NEW');
    expect(r2.access).toBe('A-NEW');
  });

  it('after a refresh completes, the in-flight slot is cleared so the next near-expiry refresh can run', async () => {
    const { oauth } = makeVault();
    const refreshFn = vi.fn(async () => ({
      access: 'A-NEW', refresh: 'R-NEW',
      expiresAt: Date.now() + 30_000,         // still near-expiry
    }));
    oauth.registerRefreshFn('google', refreshFn);

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
      expiresAt: Date.now() + 30_000,
    });

    await oauth.getTokens('google');
    await oauth.getTokens('google');
    // Two separate near-expiry windows → two refreshes.
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });
});

describe('OAuthVault — refresh-token rotation', () => {
  it('persists the new refresh token if the refresh fn returns one', async () => {
    const { vault, oauth } = makeVault();
    oauth.registerRefreshFn('google', async () => ({
      access: 'A-NEW', refresh: 'R-ROTATED',
      expiresAt: Date.now() + 3_600_000,
    }));

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
    });
    await oauth.refreshTokens('google');

    const persisted = JSON.parse(await vault.get('oauth:google:default'));
    expect(persisted.refresh).toBe('R-ROTATED');
  });

  it('keeps the previous refresh token if the refresh fn omits one', async () => {
    const { vault, oauth } = makeVault();
    oauth.registerRefreshFn('google', async () => ({
      access: 'A-NEW',
      expiresAt: Date.now() + 3_600_000,
      // no refresh field
    }));

    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R-OLD',
    });
    await oauth.refreshTokens('google');

    const persisted = JSON.parse(await vault.get('oauth:google:default'));
    expect(persisted.refresh).toBe('R-OLD');
    expect(persisted.access).toBe('A-NEW');
  });
});

describe('OAuthVault — revoke', () => {
  it('revokeTokens removes the bundle so subsequent getTokens returns null', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, { access: 'A', refresh: 'R' });
    expect(await oauth.getTokens('google')).not.toBeNull();

    await oauth.revokeTokens('google');
    expect(await oauth.getTokens('google')).toBeNull();
  });

  it('revoking one accountId leaves siblings intact', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', 'alice@personal.com', { access: 'P' });
    await oauth.storeTokens('google', 'alice@work.org',     { access: 'W' });

    await oauth.revokeTokens('google', 'alice@personal.com');
    expect(await oauth.getTokens('google', 'alice@personal.com')).toBeNull();
    expect((await oauth.getTokens('google', 'alice@work.org')).access).toBe('W');
  });
});

describe('makeAuthorizedFetch — reactive 401 retry (Q-F.2)', () => {
  it('attaches Bearer header from stored access token on 200', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, {
      access: 'A-OK', refresh: 'R',
    });
    const refreshFn = vi.fn(async () => ({ access: 'A-NEW' }));
    oauth.registerRefreshFn('google', refreshFn);

    const fetchStub = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer A-OK');
      return new Response('ok', { status: 200 });
    });

    const fetchAuth = makeAuthorizedFetch(oauth, 'google', undefined, { fetch: fetchStub });
    const res = await fetchAuth('https://example.com/me');
    expect(res.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('on 401, refreshes and retries once with the new access token', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, {
      access: 'A-OLD', refresh: 'R',
    });
    const refreshFn = vi.fn(async () => ({
      access: 'A-NEW', refresh: 'R',
      expiresAt: Date.now() + 3_600_000,
    }));
    oauth.registerRefreshFn('google', refreshFn);

    let call = 0;
    const fetchStub = vi.fn(async (_url, init) => {
      call += 1;
      if (call === 1) {
        expect(init.headers.Authorization).toBe('Bearer A-OLD');
        return new Response('nope', { status: 401 });
      }
      expect(init.headers.Authorization).toBe('Bearer A-NEW');
      return new Response('yes', { status: 200 });
    });

    const fetchAuth = makeAuthorizedFetch(oauth, 'google', undefined, { fetch: fetchStub });
    const res = await fetchAuth('https://example.com/me');
    expect(res.status).toBe(200);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('on 401 without a refresh token, does not retry and returns the 401 response', async () => {
    const { oauth } = makeVault();
    await oauth.storeTokens('google', null, { access: 'A-OLD' /* no refresh */ });
    const refreshFn = vi.fn();
    oauth.registerRefreshFn('google', refreshFn);

    const fetchStub = vi.fn(async () => new Response('nope', { status: 401 }));

    const fetchAuth = makeAuthorizedFetch(oauth, 'google', undefined, { fetch: fetchStub });
    const res = await fetchAuth('https://example.com/me');
    expect(res.status).toBe(401);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('throws OAUTH_NO_TOKENS if there are no stored tokens', async () => {
    const { oauth } = makeVault();
    const fetchStub = vi.fn();
    const fetchAuth = makeAuthorizedFetch(oauth, 'google', undefined, { fetch: fetchStub });
    await expect(fetchAuth('https://example.com/me'))
      .rejects.toMatchObject({ code: 'OAUTH_NO_TOKENS' });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

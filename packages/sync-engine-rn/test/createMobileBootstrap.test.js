import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMobileBootstrap } from '../index.js';
import { clearBgRunOnce, bgRunOnce } from '../src/bgRunOnce.js';

vi.mock('@canopy/pod-client', () => {
  class FakePodClient { constructor(args) { this.args = args; } }
  class FakeSolidOidcAuth { constructor(args) { this.args = args; } }
  return { PodClient: FakePodClient, SolidOidcAuth: FakeSolidOidcAuth };
});

function buildOidcStub({ authenticated = true } = {}) {
  return {
    restoreFromVault:      vi.fn(async () => authenticated),
    isAuthenticated:       vi.fn(() => authenticated),
    getAuthenticatedFetch: vi.fn(() => () => Promise.resolve({ ok: true })),
    webid:                 'https://anne.example/profile/card#me',
    logout:                vi.fn(async () => {}),
  };
}

describe('createMobileBootstrap', () => {
  beforeEach(() => clearBgRunOnce());

  it('rejects when oidc is missing', async () => {
    await expect(createMobileBootstrap({ buildEngine: async () => null }))
      .rejects.toThrow(/oidc required/);
  });

  it('rejects when buildEngine is missing', async () => {
    await expect(createMobileBootstrap({ oidc: buildOidcStub() }))
      .rejects.toThrow(/buildEngine required/);
  });

  it('returns authenticated:false when restoreFromVault returns false', async () => {
    const oidc = buildOidcStub({ authenticated: false });
    const r = await createMobileBootstrap({
      oidc,
      buildEngine: vi.fn(),
    });
    expect(r.authenticated).toBe(false);
    expect(r.engine).toBeNull();
    expect(r.podClient).toBeNull();
    expect(typeof r.detach).toBe('function');
    await r.detach();
  });

  it('builds engine with podClient when authenticated + podCfg given', async () => {
    const oidc = buildOidcStub();
    const fakeEngine = { runOnce: vi.fn(async () => ({ uploads: 1 })), stop: vi.fn(async () => {}) };
    const buildEngine = vi.fn(async ({ podClient, oidc }) => {
      expect(podClient).toBeTruthy();
      expect(podClient.args.podRoot).toBe('https://anne.example/');
      expect(oidc.webid).toBe('https://anne.example/profile/card#me');
      return fakeEngine;
    });
    const r = await createMobileBootstrap({
      oidc,
      podCfg:    { podRoot: 'https://anne.example/' },
      buildEngine,
      runOnceFn: (e) => () => e.runOnce(),
    });
    expect(r.authenticated).toBe(true);
    expect(r.engine).toBe(fakeEngine);
    // bg task forwards to engine.runOnce
    const r2 = await bgRunOnce();
    expect(r2).toEqual({ uploads: 1 });
    expect(fakeEngine.runOnce).toHaveBeenCalledOnce();

    await r.detach();
    expect(fakeEngine.stop).toHaveBeenCalledOnce();
    expect(await bgRunOnce()).toBeNull();
  });

  it('builds engine WITHOUT podClient when podCfg omitted (local-only mode)', async () => {
    const oidc = buildOidcStub();
    const buildEngine = vi.fn(async ({ podClient }) => {
      expect(podClient).toBeNull();
      return { stop: async () => {} };
    });
    const r = await createMobileBootstrap({ oidc, buildEngine });
    expect(r.authenticated).toBe(true);
    expect(r.podClient).toBeNull();
    expect(buildEngine).toHaveBeenCalledOnce();
  });

  it('honours custom restoreTokens callback (overriding oidc.restoreFromVault)', async () => {
    const oidc = buildOidcStub({ authenticated: true });
    oidc.restoreFromVault = vi.fn(async () => { throw new Error('should not be called'); });
    const restore = vi.fn(async () => true);
    const buildEngine = vi.fn(async () => ({ stop: async () => {} }));
    await createMobileBootstrap({
      oidc, restoreTokens: restore, buildEngine,
    });
    expect(restore).toHaveBeenCalledOnce();
    expect(oidc.restoreFromVault).not.toHaveBeenCalled();
  });
});

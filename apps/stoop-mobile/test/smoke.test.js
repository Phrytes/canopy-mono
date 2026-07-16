/**
 * Phase 40.1 smoke — the workspace builds + the substrate barrels
 * resolve.  Real screens + behaviour land in later phases.
 */

import { describe, it, expect } from 'vitest';

describe('stoop-mobile — Phase 40.1 scaffold', () => {
  it('package.json declares the expected name + private flag', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.name).toBe('@onderling-app/stoop-mobile');
    expect(pkg.default.private).toBe(true);
  });

  it('depends on the lifted-from-Stoop substrates', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    const deps = pkg.default.dependencies;
    expect(deps['@onderling/local-store']).toMatch(/local-store/);
    expect(deps['@onderling/chat-p2p']).toMatch(/chat-p2p/);
    expect(deps['@onderling/identity-resolver']).toMatch(/identity-resolver/);
    expect(deps['@onderling/sync-engine-rn']).toMatch(/sync-engine-rn/);
    expect(deps['@onderling/oidc-session-rn']).toMatch(/oidc-session-rn/);
    // The platform-shell exception: stoop-mobile depends on stoop's
    // SyncEngine subclass / Agent factory / groupMirror.
    expect(deps['@onderling-app/stoop']).toMatch(/stoop/);
  });

  it('app.json has stoop:// scheme + Android permissions', async () => {
    const app = await import('../app.json', { with: { type: 'json' } });
    expect(app.default.expo.scheme).toBe('stoop');
    expect(app.default.expo.android.permissions).toContain('android.permission.CAMERA');
    expect(app.default.expo.android.permissions).toContain('android.permission.ACCESS_COARSE_LOCATION');
  });

  it('lifted substrates are loadable', async () => {
    const localStore     = await import('@onderling/local-store');
    const identityRes    = await import('@onderling/identity-resolver');
    const chatP2p        = await import('@onderling/chat-p2p');
    const syncEngineRn   = await import('@onderling/sync-engine-rn');
    const oidcSessionRn  = await import('@onderling/oidc-session-rn');

    expect(typeof localStore.CachingDataSource).toBe('function');
    expect(typeof localStore.createSettingsModule).toBe('function');
    expect(typeof identityRes.MemberMap).toBe('function');
    expect(typeof identityRes.MemberMapCache).toBe('object');
    expect(typeof identityRes.buildOnboardingSkills).toBe('function');
    expect(typeof identityRes.matchesProfile).toBe('function');
    expect(typeof chatP2p.wireChat).toBe('function');
    expect(typeof syncEngineRn.createMobileBootstrap).toBe('function');
    expect(typeof syncEngineRn.createSyncEngine).toBe('function');
    expect(typeof oidcSessionRn.OidcSessionRN).toBe('function');
  });
});

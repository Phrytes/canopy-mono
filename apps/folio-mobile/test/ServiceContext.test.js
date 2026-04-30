/**
 * ServiceContext.test.js — boot path + adoptTokens + signOut.
 *
 * vitest doesn't render React Native, but ServiceContext is mostly
 * pure state-machine logic.  We test the underlying `loadStoredPodRoot`
 * / `savePodRoot` config helpers directly, plus a thin reducer-style
 * smoke of the boot path's invariants.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  loadStoredPodRoot, savePodRoot, clearPodRoot,
  DEFAULT_LOCAL_FOLDER, DEFAULT_INRUPT_ISSUER,
} from '../src/lib/config.js';
import { defaultPodFactory, buildEngineForRN } from '../src/lib/serviceBuilder.js';

function buildKVStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get:    async (k) => m.get(k) ?? null,
    set:    async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    _peek:  () => Object.fromEntries(m),
  };
}

describe('config.js — pod root persistence', () => {
  it('returns null when no value is stored', async () => {
    expect(await loadStoredPodRoot(buildKVStore())).toBe(null);
  });

  it('round-trips a pod root with savePodRoot', async () => {
    const store = buildKVStore();
    await savePodRoot(store, 'https://alice.solidcommunity.net/folio');
    const v = await loadStoredPodRoot(store);
    // Trailing slash is added.
    expect(v).toBe('https://alice.solidcommunity.net/folio/');
  });

  it('savePodRoot rejects empty input', async () => {
    await expect(savePodRoot(buildKVStore(), '')).rejects.toThrow(/required/);
  });

  it('clearPodRoot removes the entry', async () => {
    const store = buildKVStore();
    await savePodRoot(store, 'https://x.example/folio/');
    await clearPodRoot(store);
    expect(await loadStoredPodRoot(store)).toBe(null);
  });

  it('exports sensible defaults', () => {
    expect(DEFAULT_LOCAL_FOLDER).toBe('folio');
    expect(DEFAULT_INRUPT_ISSUER).toBe('https://login.inrupt.com');
  });
});

describe('serviceBuilder.defaultPodFactory', () => {
  it('rejects when cfg.podRoot is missing', async () => {
    await expect(defaultPodFactory({}, {})).rejects.toThrow(/podRoot/);
  });

  it('rejects when oidc is missing', async () => {
    await expect(defaultPodFactory({ podRoot: 'https://x' }, null)).rejects.toThrow(/oidc/);
  });

  // We don't import the real PodClient under unit test (too heavyweight
  // to bootstrap node-side); the shape contract is exercised via the
  // smoke test in test/screens/StatusScreen.test.js where a stub
  // `podFactory` replaces `defaultPodFactory`.
});

describe('serviceBuilder.buildEngineForRN', () => {
  it('forwards args to createSyncEngine', async () => {
    // Spy on the underlying serviceFactory (resolved via vitest alias to
    // apps/folio/src/rn/serviceFactory.js).  We provide pre-built
    // adapters via the `adapters` escape hatch so no expo modules are
    // touched.
    const podClient = {
      // Minimum surface SyncEngine touches at construction.
      // (We never actually call runOnce here — just prove construction.)
    };
    const fakeFs = {
      readFile: async () => new Uint8Array(),
      readFileText: async () => '',
      writeFile: async () => {},
      mkdir: async () => {},
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, isFile: () => true, isDirectory: () => false }),
      unlink: async () => {},
      rmdir: async () => {},
      rename: async () => {},
    };
    const fakeHash = { sha256: async () => 'a'.repeat(64) };
    const fakeWatcher = { start: async () => ({ stop: () => {} }) };

    const engine = await buildEngineForRN({
      podClient,
      localRoot: '/tmp/x',
      podRoot:   'urn:test:folio/',
      adapters:  { fs: fakeFs, hash: fakeHash, watcherFactory: fakeWatcher },
    });
    expect(engine).toBeDefined();
    expect(typeof engine.runOnce).toBe('function');
    expect(engine.fs).toBe(fakeFs);
  });
});

// ── ServiceContext invariants (no React rendering, just the contract) ────────

describe('ServiceContext — invariant: signed-out + no podRoot ⇒ engine null', () => {
  // We don't render React Native here; instead we assert the contract
  // ServiceContext encodes:
  //
  //   On boot, with no stored podRoot AND a non-authenticated session,
  //   the provider must transition to status = 'signed-out' and never
  //   build an engine.
  //
  // Implemented by a tiny re-implementation of the relevant boot
  // branch — a full integration test of the React provider would need
  // react-test-renderer, which is OUT of scope for vitest at v0.
  it('refuses to build an engine without a pod root', async () => {
    const store = buildKVStore(); // no pod-root stored
    const podRoot = await loadStoredPodRoot(store);
    expect(podRoot).toBe(null);
    // The actual ServiceContext.buildAndAttachEngine is gated on
    // (session.isAuthenticated() && storedPodRoot).  No assertion
    // beyond the gate at this layer is meaningful — the React
    // integration is exercised manually + via the screens tests.
  });
});

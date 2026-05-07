import { describe, it, expect, vi } from 'vitest';
import { createSyncEngine } from '../index.js';

// Stub the substrate adapters so we don't need the full SyncEngine
// dependency tree at test time.
vi.mock('@canopy/sync-engine/adapters/fsRN', () => ({
  createFsRN: vi.fn((args) => ({ kind: 'fs', args })),
}));
vi.mock('@canopy/sync-engine/adapters/hashRN', () => ({
  createHashRN: vi.fn((args) => ({ kind: 'hash', args })),
}));
vi.mock('@canopy/sync-engine/adapters/watcherRN', () => ({
  createWatcherRN: vi.fn((args) => ({ kind: 'watcher', args })),
  DEFAULT_POLL_INTERVAL_MS: 10_000,
}));
vi.mock('@canopy/sync-engine/SyncEngine', () => {
  class FakeSubstrateSyncEngine {
    constructor(opts) { this.opts = opts; this.kind = 'substrate'; }
  }
  return { SyncEngine: FakeSubstrateSyncEngine };
});

describe('createSyncEngine', () => {
  const podClient = { fake: 'pod' };
  const localRoot = 'file:///docs/folio';
  const podRoot   = 'https://anne.example/folio/';

  it('rejects missing args', () => {
    expect(() => createSyncEngine()).toThrow(/args required/);
    expect(() => createSyncEngine({})).toThrow(/podClient required/);
    expect(() => createSyncEngine({ podClient })).toThrow(/localRoot required/);
    expect(() => createSyncEngine({ podClient, localRoot })).toThrow(/podRoot required/);
  });

  it('builds a substrate SyncEngine with peer-injected FileSystem + Crypto', () => {
    const FileSystem = { documentDirectory: 'file:///docs/' };
    const Crypto     = { digestStringAsync: vi.fn() };
    const engine = createSyncEngine({
      podClient, localRoot, podRoot, FileSystem, Crypto,
    });
    expect(engine.kind).toBe('substrate');
    expect(engine.opts.podClient).toBe(podClient);
    expect(engine.opts.localRoot).toBe(localRoot);
    expect(engine.opts.podRoot).toBe(podRoot);
    expect(engine.opts.fs.kind).toBe('fs');
    expect(engine.opts.hash.kind).toBe('hash');
    expect(engine.opts.watcherFactory.kind).toBe('watcher');
  });

  it('uses pre-built adapters when supplied (test escape hatch)', () => {
    const adapters = { fs: 'F', hash: 'H', watcherFactory: 'W' };
    const engine = createSyncEngine({ podClient, localRoot, podRoot, adapters });
    expect(engine.opts.fs).toBe('F');
    expect(engine.opts.hash).toBe('H');
    expect(engine.opts.watcherFactory).toBe('W');
  });

  it('rejects partial adapters', () => {
    expect(() => createSyncEngine({ podClient, localRoot, podRoot, adapters: { fs: 'F' } }))
      .toThrow(/adapters must provide/);
  });

  it('honours custom SyncEngineClass (folio-style subclass)', () => {
    class FolioSyncEngine {
      constructor(opts) { this.opts = opts; this.kind = 'folio'; }
    }
    const adapters = { fs: 'F', hash: 'H', watcherFactory: 'W' };
    const engine = createSyncEngine({
      podClient, localRoot, podRoot, adapters,
      SyncEngineClass: FolioSyncEngine,
    });
    expect(engine.kind).toBe('folio');
    expect(engine).toBeInstanceOf(FolioSyncEngine);
  });

  it('rejects when neither FileSystem nor adapters supplied', () => {
    expect(() => createSyncEngine({ podClient, localRoot, podRoot }))
      .toThrow(/FileSystem .* required/);
  });

  it('rejects when FileSystem is supplied but Crypto is not', () => {
    expect(() => createSyncEngine({ podClient, localRoot, podRoot, FileSystem: {} }))
      .toThrow(/Crypto .* required/);
  });
});

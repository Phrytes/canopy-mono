/**
 * serviceFactory.test.js — smoke test for the RN-flavored SyncEngine
 * factory.  Builds an engine with mocked FileSystem + Crypto and calls
 * `runOnce()` against an in-memory pod client.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir }    from 'node:os';
import { join }      from 'node:path';

import { createSyncEngine } from '../../src/rn/serviceFactory.js';
import { fsNode }           from '../../src/adapters/fsNode.js';
import { hashNode }         from '../../src/adapters/hashNode.js';
import { watcherNode }      from '../../src/adapters/watcherNode.js';

/**
 * Trivial in-memory MockPodClient — the same surface SyncEngine actually
 * uses (read / write / list / exists / createContainer / deleteCompletely).
 */
class MockPodClient {
  constructor() {
    this.store = new Map();         // uri → { content, contentType, etag, lastModified }
    this.containers = new Set();
  }
  async createContainer(uri) {
    this.containers.add(uri.endsWith('/') ? uri : `${uri}/`);
  }
  async write(uri, content, opts = {}) {
    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : (content instanceof Uint8Array ? content : new Uint8Array(content));
    this.store.set(uri, {
      content: bytes,
      contentType: opts.contentType ?? 'application/octet-stream',
      etag: `"etag-${this.store.size}"`,
      lastModified: new Date().toUTCString(),
    });
  }
  async read(uri, opts = {}) {
    const e = this.store.get(uri);
    if (!e) {
      const err = new Error(`NOT_FOUND ${uri}`); err.code = 'NOT_FOUND'; throw err;
    }
    if (opts.decode === 'string') {
      return { content: new TextDecoder('utf8').decode(e.content), etag: e.etag, lastModified: e.lastModified, size: e.content.byteLength };
    }
    return { content: e.content, etag: e.etag, lastModified: e.lastModified, size: e.content.byteLength };
  }
  async list(containerUri /*, opts */) {
    const root = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const entries = [];
    for (const k of this.store.keys()) {
      if (!k.startsWith(root)) continue;
      const tail = k.slice(root.length);
      if (tail.length === 0 || tail.includes('/')) continue;
      entries.push({ uri: k, type: 'resource' });
    }
    return { entries };
  }
  async exists(uri) {
    return this.store.has(uri);
  }
}

describe('createSyncEngine — argument validation', () => {
  it('throws when args are missing', () => {
    // 2026-05-08: folio's serviceFactory is now a thin shim that
    // pre-binds `SyncEngineClass: FolioSyncEngine` and forwards to
    // `@onderling/sync-engine-rn`. The substrate sees the spread and
    // its first guard is `podClient required` (the spread provides a
    // truthy args object). Either error message indicates the same
    // "no real args" failure.
    expect(() => createSyncEngine()).toThrow(/args required|podClient required/);
  });
  it('throws when podClient is missing', () => {
    expect(() => createSyncEngine({ localRoot: '/x', podRoot: 'urn:x' })).toThrow(/podClient/);
  });
  it('throws when localRoot is missing', () => {
    expect(() => createSyncEngine({ podClient: {}, podRoot: 'urn:x' })).toThrow(/localRoot/);
  });
  it('throws when podRoot is missing', () => {
    expect(() => createSyncEngine({ podClient: {}, localRoot: '/x' })).toThrow(/podRoot/);
  });
  it('throws when neither FileSystem/Crypto nor adapters are provided', () => {
    expect(() => createSyncEngine({
      podClient: {}, localRoot: '/x', podRoot: 'urn:x',
    })).toThrow(/FileSystem|adapters/);
  });
  it('throws when adapters object is incomplete', () => {
    expect(() => createSyncEngine({
      podClient: {}, localRoot: '/x', podRoot: 'urn:x',
      adapters: { fs: {} }, // missing hash + watcherFactory
    })).toThrow(/adapters/);
  });
});

describe('createSyncEngine — engine construction with adapter escape hatch', () => {
  it('returns a SyncEngine wired with the supplied adapters', () => {
    const engine = createSyncEngine({
      podClient:  new MockPodClient(),
      localRoot:  '/dummy',
      podRoot:    'urn:rn-test:notes/',
      adapters:   { fs: fsNode, hash: hashNode, watcherFactory: watcherNode },
    });
    expect(engine).toBeDefined();
    expect(typeof engine.runOnce).toBe('function');
    expect(engine.fs).toBe(fsNode);
    expect(engine.hash).toBe(hashNode);
  });

  it('runOnce() pushes local files to a MockPodClient', async () => {
    // We use the Node adapter via the escape hatch + a real tmp dir so the
    // smoke test exercises the engine end-to-end without needing a mocked
    // FileSystem.  This is enough to prove the C1-shaped construction
    // path works at all (per the DoD bullet).
    const root = mkdtempSync(join(tmpdir(), 'folio-c1-svc-'));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'a.md'), '# A');
      writeFileSync(join(root, 'b.md'), '# B');

      const pod = new MockPodClient();
      const engine = createSyncEngine({
        podClient: pod,
        localRoot: root,
        podRoot:   'urn:c1-smoke:notes/',
        adapters:  { fs: fsNode, hash: hashNode, watcherFactory: watcherNode },
      });
      const r = await engine.runOnce({ direction: 'push' });
      expect(r.uploads).toBe(2);
      expect(pod.store.has('urn:c1-smoke:notes/a.md')).toBe(true);
      expect(pod.store.has('urn:c1-smoke:notes/b.md')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('createSyncEngine — built-in RN adapter wiring', () => {
  // Build a minimal mock FileSystem + Crypto pair that's just enough for
  // the constructor path to succeed.  The engine doesn't actually run
  // here — we just prove the wiring path doesn't throw and produces an
  // engine whose `fs.readFile` / `hash.sha256` / watcher route through
  // the supplied namespaces.
  function buildMockExpoNamespaces() {
    const FS_STORE = new Map();
    const FileSystem = {
      EncodingType: { UTF8: 'utf8', Base64: 'base64' },
      async readAsStringAsync(uri, opts = {}) {
        const e = FS_STORE.get(uri);
        if (!e) { const err = new Error('No such file'); throw err; }
        if (opts.encoding === 'base64') return Buffer.from(e).toString('base64');
        return Buffer.from(e).toString('utf8');
      },
      async writeAsStringAsync(uri, content, opts = {}) {
        const bytes = opts.encoding === 'base64'
          ? Uint8Array.from(Buffer.from(content, 'base64'))
          : Uint8Array.from(Buffer.from(String(content), 'utf8'));
        FS_STORE.set(uri, bytes);
      },
      async deleteAsync(uri) { FS_STORE.delete(uri); },
      async makeDirectoryAsync() {},
      async readDirectoryAsync() { return []; },
      async getInfoAsync(uri) {
        if (FS_STORE.has(uri)) {
          return { exists: true, isDirectory: false, size: FS_STORE.get(uri).byteLength, modificationTime: 0 };
        }
        return { exists: false };
      },
      async moveAsync({ from, to }) {
        const e = FS_STORE.get(from); if (!e) throw new Error('No such file');
        FS_STORE.delete(from); FS_STORE.set(to, e);
      },
    };
    const Crypto = {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      CryptoEncoding:        { UTF8: 'utf8', BASE64: 'base64' },
      async digestStringAsync(/* algo, data, opts */) {
        return '0'.repeat(64); // shape-only stub
      },
    };
    return { FileSystem, Crypto };
  }

  it('builds an engine when given mock FileSystem + Crypto namespaces', () => {
    const { FileSystem, Crypto } = buildMockExpoNamespaces();
    const engine = createSyncEngine({
      podClient: new MockPodClient(),
      localRoot: 'file:///doc/folio',
      podRoot:   'urn:rn-test:notes/',
      FileSystem,
      Crypto,
      watcherIntervalMs: 30_000,
      pollIntervalMs:    60_000,
    });
    expect(engine).toBeDefined();
    expect(typeof engine.runOnce).toBe('function');
    // The injected adapters expose the methods we care about.
    expect(typeof engine.fs.readFile).toBe('function');
    expect(typeof engine.hash.sha256).toBe('function');
  });
});

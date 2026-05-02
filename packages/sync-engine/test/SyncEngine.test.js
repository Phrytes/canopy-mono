import { describe, it, expect, vi } from 'vitest';
import {
  SyncEngine,
  IngestQueueSource,
  InMemoryBackend,
  classifyStorage,
  buildReferenceManifest,
} from '../src/index.js';

const POD_ROOT = 'https://test.example/archive';

function buildEngine(extra = {}) {
  const source  = new IngestQueueSource();
  const backend = new InMemoryBackend();
  const engine  = new SyncEngine({ source, backend, podRoot: POD_ROOT, ...extra });
  return { source, backend, engine };
}

describe('SyncEngine — basic lifecycle', () => {
  it('rejects construction without source/backend/podRoot', () => {
    const source  = new IngestQueueSource();
    const backend = new InMemoryBackend();
    expect(() => new SyncEngine({ backend, podRoot: 'x' })).toThrow();
    expect(() => new SyncEngine({ source, podRoot: 'x' })).toThrow();
    expect(() => new SyncEngine({ source, backend })).toThrow();
  });

  it('starts + stops idempotently', async () => {
    const { engine } = buildEngine();
    await engine.start();
    await engine.start();
    await engine.stop();
    await engine.stop();
  });
});

describe('SyncEngine — ingest queue → backend (direct storage)', () => {
  it('writes a small text item directly', async () => {
    const { engine, source, backend } = buildEngine();
    await engine.start();
    await source.ingest({
      relPath:     'gmail/msg-1.md',
      content:     '# Subject\nBody',
      contentType: 'text/markdown',
    });
    const stored = await backend.get(`${POD_ROOT}/gmail/msg-1.md`);
    expect(stored.kind).toBe('direct');
    expect(stored.content).toContain('Subject');
  });

  it('emits a synced event per item', async () => {
    const { engine, source } = buildEngine();
    const synced = [];
    engine.on('synced', (e) => synced.push(e.path));
    await engine.start();
    await source.ingestMany([
      { relPath: 'a.md', content: 'a' },
      { relPath: 'b.md', content: 'b' },
    ]);
    expect(synced).toEqual([
      `${POD_ROOT}/a.md`,
      `${POD_ROOT}/b.md`,
    ]);
  });

  it('items pushed before start() are flushed on start()', async () => {
    const { engine, source, backend } = buildEngine();
    await source.ingest({ relPath: 'before-start.md', content: 'x' });
    expect(source.pending).toBe(1);
    await engine.start();
    // tiny tick for the start() flush to drain the queue
    await new Promise((r) => setTimeout(r, 0));
    expect(await backend.get(`${POD_ROOT}/before-start.md`)).toBeTruthy();
  });

  it('syncOnce drains pending items synchronously', async () => {
    const { engine, source, backend } = buildEngine();
    await source.ingest({ relPath: 'q.md', content: 'q' });
    await engine.syncOnce();
    expect(await backend.get(`${POD_ROOT}/q.md`)).toBeTruthy();
  });
});

describe('SyncEngine — reference storage (big content)', () => {
  it('stores a manifest when item is too big and referenceUri is provided', async () => {
    const { engine, source, backend } = buildEngine({
      storageConvention: { smallThresholdBytes: 100 },
    });
    await engine.start();
    await source.ingest({
      relPath:      'photos/big.jpg',
      size:         5_000_000,
      referenceUri: 'https://blob.example/abc.jpg',
      contentType:  'image/jpeg',
      hash:         'sha256:deadbeef',
    });
    const stored = await backend.get(`${POD_ROOT}/photos/big.jpg`);
    expect(stored.kind).toBe('reference');
    expect(stored.uri).toBe('https://blob.example/abc.jpg');
    expect(stored.size).toBe(5_000_000);
  });

  it('emits error if item is too big but no referenceUri provided', async () => {
    const { engine, source } = buildEngine({
      storageConvention: { smallThresholdBytes: 100 },
    });
    const errors = [];
    engine.on('error', (e) => errors.push(e));
    await engine.start();
    await source.ingest({
      relPath: 'big.bin',
      size:    5_000_000,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toMatch(/referenceUri/);
  });
});

describe('SyncEngine — conflict policies', () => {
  it('LWW: incoming wins; emits conflict event', async () => {
    const { engine, source, backend } = buildEngine();
    await backend.put(`${POD_ROOT}/c.md`, {
      kind: 'direct', content: 'old', lastModified: 1000,
    });
    const conflicts = [];
    engine.on('conflict', (e) => conflicts.push(e));
    await engine.start();
    await source.ingest({
      relPath: 'c.md', content: 'new', lastModified: 2000,
    });
    const stored = await backend.get(`${POD_ROOT}/c.md`);
    expect(stored.content).toBe('new');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe('lww');
  });

  it('event-only: caller resolves via the resolve() callback', async () => {
    const { engine, source, backend } = buildEngine({
      conflictPolicy: 'event-only',
    });
    await backend.put(`${POD_ROOT}/c.md`, {
      kind: 'direct', content: 'old', lastModified: 1000,
    });
    engine.on('conflict', ({ resolve, local }) => {
      // Choose to keep local — pass the existing record back as resolution.
      resolve({
        ...local,
        content: 'manually-resolved',
        lastModified: 3000,
      });
    });
    await engine.start();
    await source.ingest({
      relPath: 'c.md', content: 'new', lastModified: 2000,
    });
    const stored = await backend.get(`${POD_ROOT}/c.md`);
    expect(stored.content).toBe('manually-resolved');
  });

  it('custom function policy controls resolution', async () => {
    const { engine, source, backend } = buildEngine({
      conflictPolicy: ({ remote }) => ({ ...remote, content: `(forced) ${remote.content}` }),
    });
    await backend.put(`${POD_ROOT}/c.md`, {
      kind: 'direct', content: 'old', lastModified: 1000,
    });
    await engine.start();
    await source.ingest({
      relPath: 'c.md', content: 'new', lastModified: 2000,
    });
    const stored = await backend.get(`${POD_ROOT}/c.md`);
    expect(stored.content).toBe('(forced) new');
  });
});

describe('storageConvention', () => {
  it('classifyStorage returns "direct" when content size <= threshold', () => {
    expect(classifyStorage({ content: 'small', smallThresholdBytes: 1000 })).toBe('direct');
    expect(classifyStorage({ size: 999, smallThresholdBytes: 1000 })).toBe('direct');
    expect(classifyStorage({ size: 1000, smallThresholdBytes: 1000 })).toBe('direct');
  });

  it('classifyStorage returns "reference" when size > threshold', () => {
    expect(classifyStorage({ size: 1001, smallThresholdBytes: 1000 })).toBe('reference');
  });

  it('buildReferenceManifest produces a kind:"reference" manifest', () => {
    const m = buildReferenceManifest({
      uri: 'https://x.com/a', size: 100, contentType: 'image/png',
    });
    expect(m).toMatchObject({
      kind: 'reference', uri: 'https://x.com/a', size: 100, contentType: 'image/png',
    });
  });

  it('buildReferenceManifest throws without uri', () => {
    expect(() => buildReferenceManifest({ size: 1 })).toThrow();
  });
});

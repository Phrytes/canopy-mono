import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createMemoryBackend } from '@onderling/pseudo-pod/memory';
import { PodSearch } from '../src/index.js';

/**
 * Persistence + lifecycle (Phase 52.23) — restart ≠ re-embed.
 *
 * Uses the real `@onderling/pseudo-pod` MemoryBackend as `vectorStore`
 * (§3.4 layout) and a deterministic fake embedder whose embed() call
 * count is the proof that a reload does NOT re-embed.
 */

// Deterministic SHA-256 (mirrors sync-engine's hashNode adapter).
const hash = async (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');

function fakeEmbedder({ id = 'fake:v1', dim = 3, table } = {}) {
  const TABLE = table ?? {
    'automobile repair': [1, 0, 0],
    'car dealership':     [0.9, 0, 0.1],
    'lunch recipe':       [0, 1, 0],
    'sunny forecast':     [0, 0, 1],
    car:                  [1, 0, 0],
  };
  const emb = {
    id,
    dim,
    calls: 0,
    embeddedTexts: 0,
    async embed(texts) {
      emb.calls += 1;
      emb.embeddedTexts += texts.length;
      return texts.map((t) => Float32Array.from(TABLE[t] ?? new Array(dim).fill(0)));
    },
  };
  return emb;
}

const SCHEMA = {
  fields: {
    id:    { primary: true },
    kind:  { facet: true },
    title: { fts: true, weight: 2, embed: true },
  },
};

const ITEMS = [
  { id: 'a', kind: 'vehicle', title: 'automobile repair' },
  { id: 'b', kind: 'food',    title: 'lunch recipe' },
  { id: 'c', kind: 'weather', title: 'sunny forecast' },
  { id: 'd', kind: 'vehicle', title: 'car dealership' },
];

const BASE = 'private/state/search-index/default/';
const MANIFEST_KEY = `${BASE}manifest`;
const ITEMS_PREFIX = `${BASE}items/`;

const getManifest = async (store) => {
  const rec = await store.get(MANIFEST_KEY);
  return rec ? JSON.parse(rec.bytes) : null;
};

describe('persist: §3.4 on-store layout', () => {
  let store;
  let e1;
  beforeEach(async () => {
    store = createMemoryBackend();
    e1 = fakeEmbedder();
    const s = new PodSearch({ schema: SCHEMA, embedder: e1, hash, vectorStore: store });
    await s.indexBatch(ITEMS);
  });

  it('writes a manifest + one record per item under the scope prefix', async () => {
    const keys = await store.list(BASE);
    expect(keys).toContain(MANIFEST_KEY);
    const itemKeys = await store.list(ITEMS_PREFIX);
    expect(itemKeys.sort()).toEqual(
      ['a', 'b', 'c', 'd'].map((id) => `${ITEMS_PREFIX}${id}`),
    );
  });

  it('manifest carries modelId/dim/chunkingV/count/builtAt', async () => {
    const m = await getManifest(store);
    expect(m.modelId).toBe('fake:v1');
    expect(m.dim).toBe(3);
    expect(m.chunkingV).toBe(1);
    expect(m.count).toBe(4);
    expect(typeof m.builtAt).toBe('string');
  });

  it('item record stores contentHash + chunks[{seq,hash,vecB64}]', async () => {
    const rec = JSON.parse((await store.get(`${ITEMS_PREFIX}a`)).bytes);
    expect(rec.itemId).toBe('a');
    expect(rec.contentHash).toBe(await hash('automobile repair'));
    expect(rec.chunks).toHaveLength(1);
    expect(rec.chunks[0]).toMatchObject({ seq: 0, hash: await hash('automobile repair') });
    expect(typeof rec.chunks[0].vecB64).toBe('string');
  });
});

describe('reload: restart ≠ re-embed', () => {
  let store;
  beforeEach(async () => {
    store = createMemoryBackend();
    const e1 = fakeEmbedder();
    const s1 = new PodSearch({ schema: SCHEMA, embedder: e1, hash, vectorStore: store });
    await s1.indexBatch(ITEMS);
    expect(e1.embeddedTexts).toBe(4); // first build embedded everything
  });

  it('a NEW PodSearch re-indexing the same items makes ZERO embed calls', async () => {
    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store });
    await s2.indexBatch(ITEMS); // reload warms cache from the store → no embed
    expect(e2.calls).toBe(0);
    expect(e2.embeddedTexts).toBe(0);

    // semantic query works over the reloaded vectors (query embed is the
    // ONLY embed call — that is expected, it embeds the query text).
    const r = await s2.query({ text: 'car', mode: 'semantic', minScore: 0.1 });
    expect(r.items.map((i) => i.id)).toEqual(['a', 'd']);
    expect(e2.calls).toBe(1);
  });

  it('reloads the vector index itself (semanticReady true with no embed)', async () => {
    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store });
    await s2.query({ text: 'x' }); // lexical query → triggers hydration, no embed
    expect(e2.calls).toBe(0);
    expect(s2.semanticReady).toBe(true); // vectors came from the store
  });

  it('similar() works after reload using the stored vectors, no embed', async () => {
    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store });
    await s2.indexBatch(ITEMS); // repopulate the item documents (zero embed)
    const sim = await s2.similar('a', { limit: 10 });
    expect(sim.items.map((i) => i.id)[0]).toBe('d');
    expect(e2.calls).toBe(0);
  });
});

describe('restart-safe content-hash cache (content-addressed)', () => {
  it('a fresh instance reuses a stored vector for the SAME text on a new item', async () => {
    const store = createMemoryBackend();
    const e1 = fakeEmbedder();
    const s1 = new PodSearch({ schema: SCHEMA, embedder: e1, hash, vectorStore: store });
    await s1.indexBatch([{ id: 'a', kind: 'vehicle', title: 'automobile repair' }]);

    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store });
    // New item id, SAME embeddable text → cache hit reconstructed from the store.
    await s2.indexBatch([{ id: 'z', kind: 'vehicle', title: 'automobile repair' }]);
    expect(e2.embeddedTexts).toBe(0);
  });
});

describe('invalidation: stale manifest → purge + lazy rebuild', () => {
  it('model change purges the persisted index (audit event) and rebuilds', async () => {
    const store = createMemoryBackend();
    const s1 = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder({ id: 'fake:v1' }), hash, vectorStore: store });
    await s1.indexBatch(ITEMS);

    const audit = vi.fn();
    const e2 = fakeEmbedder({ id: 'fake:v2' }); // different model id
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store, audit });
    await s2.query({ text: 'x' }); // triggers hydration → detects stale → purge

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'index-invalidated', reason: 'model' }));
    expect(await store.list(ITEMS_PREFIX)).toEqual([]);
    expect(await getManifest(store)).toBeNull();

    // Rebuild lazily — new model re-embeds (does NOT serve v1 vectors).
    await s2.indexBatch(ITEMS);
    expect(e2.embeddedTexts).toBe(4);
    expect((await getManifest(store)).modelId).toBe('fake:v2');
  });

  it('chunking-version change also invalidates (reason: chunking)', async () => {
    const store = createMemoryBackend();
    const s1 = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    await s1.indexBatch(ITEMS);

    const audit = vi.fn();
    const s2 = new PodSearch({
      schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store, audit,
      chunking: { version: 2 },
    });
    await s2.query({ text: 'x' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'index-invalidated', reason: 'chunking' }));
    expect(await store.list(ITEMS_PREFIX)).toEqual([]);
  });
});

describe('tombstones: deleteById / reindex evict from the store', () => {
  let store;
  beforeEach(async () => {
    store = createMemoryBackend();
    const s = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    await s.indexBatch(ITEMS);
  });

  it('deleteById removes the persisted item + updates manifest count', async () => {
    const s = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    await s.indexBatch(ITEMS); // reload (zero embed), then delete
    await s.deleteById('d');
    expect(await store.get(`${ITEMS_PREFIX}d`)).toBeNull();
    expect((await store.list(ITEMS_PREFIX)).length).toBe(3);
    expect((await getManifest(store)).count).toBe(3);

    // A subsequent reload never resurrects 'd'.
    const s2 = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    await s2.indexBatch(ITEMS.filter((it) => it.id !== 'd'));
    const sim = await s2.similar('a', { limit: 10 });
    expect(sim.items.map((i) => i.id)).not.toContain('d');
  });

  it('reindex purges every persisted record + the manifest', async () => {
    const s = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    await s.reindex();
    expect(await store.list(ITEMS_PREFIX)).toEqual([]);
    expect(await getManifest(store)).toBeNull();
  });
});

describe('backward-compat: no vectorStore ⇒ pure in-memory', () => {
  it('semantic search works and nothing is persisted anywhere', async () => {
    const e = fakeEmbedder();
    const s = new PodSearch({ schema: SCHEMA, embedder: e, hash }); // no vectorStore
    await s.indexBatch(ITEMS);
    const r = await s.query({ text: 'car', mode: 'semantic', minScore: 0.1 });
    expect(r.items.map((i) => i.id)).toEqual(['a', 'd']);
    // A NEW instance (no shared store) must re-embed — no cross-instance state.
    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash });
    await s2.indexBatch(ITEMS);
    expect(e2.embeddedTexts).toBe(4);
  });
});

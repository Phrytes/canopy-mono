import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createMemoryBackend } from '@onderling/pseudo-pod/memory';
import { createPseudoPod } from '@onderling/pseudo-pod';
import { PodSearch, createBackfill } from '../src/index.js';

/**
 * Backfill orchestrator (Phase 52.24) — one-time, resumable, idle-friendly.
 *
 * Proofs:
 *   1. a full walk indexes everything + fires progress/done.
 *   2. kill + resume from the cursor does NOT re-embed completed items —
 *      the completed prefix contributes 0 new embed calls on the resumed run.
 *   3. pause()/resume() stops + continues at a batch boundary.
 *   4. the SAME orchestrator drives a pseudo-pod source and a mocked
 *      PodClient-shaped source identically (pod-independence).
 */

const hash = async (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');

/** Deterministic fake embedder — every distinct text gets a unique unit-ish vector. */
function fakeEmbedder({ id = 'fake:v1', dim = 4 } = {}) {
  const emb = {
    id,
    dim,
    calls: 0,
    embeddedTexts: 0,
    seen: [],
    async embed(texts) {
      emb.calls += 1;
      emb.embeddedTexts += texts.length;
      emb.seen.push(...texts);
      return texts.map((t) => {
        // Cheap deterministic embedding: hash chars into `dim` buckets.
        const v = new Float32Array(dim);
        for (let i = 0; i < String(t).length; i += 1) {
          v[String(t).charCodeAt(i) % dim] += 1;
        }
        v[0] += 0.001; // never a zero vector
        return v;
      });
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

/** 8 items with pairwise-distinct embeddable text. */
const ITEMS = Array.from({ length: 8 }, (_, i) => ({
  id: `item-${i}`,
  kind: i % 2 === 0 ? 'even' : 'odd',
  title: `document number ${i} about topic ${String.fromCharCode(97 + i)}`,
}));

/** In-memory `{ list, read }` source — the "floor" adapter. */
function seededSource(items, { prefix = 'mem://items/' } = {}) {
  const byUri = new Map(items.map((it) => [`${prefix}${it.id}`, it]));
  return {
    reads: [],
    async list() { return [...byUri.keys()]; },
    async read(uri) {
      this.reads.push(uri);
      return byUri.get(uri);
    },
  };
}

/** A PodClient-SHAPED source: same `{ list, read }`, but list yields `{uri}` objects. */
function mockPodClientSource(items, { prefix = 'https://pod.example/items/' } = {}) {
  const byUri = new Map(items.map((it) => [`${prefix}${it.id}`, it]));
  return {
    reads: [],
    async list() { return [...byUri.keys()].map((uri) => ({ uri })); }, // {uri}[] shape
    async read(uri) {
      this.reads.push(uri);
      return byUri.get(uri);
    },
  };
}

// A synchronous yield keeps the tests fast + deterministic (pause() is called
// from the sync progress handler, so a microtask yield is enough).
const microYield = () => Promise.resolve();

describe('backfill: full walk', () => {
  let store;
  let embedder;
  let search;
  let source;

  beforeEach(() => {
    store = createMemoryBackend();
    embedder = fakeEmbedder();
    search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store });
    source = seededSource(ITEMS);
  });

  it('indexes every item and fires progress + done', async () => {
    const progress = [];
    let doneEvt = null;
    const bf = createBackfill({ search, source, batchSize: 3, yield: microYield });
    bf.on('progress', (p) => progress.push(p));
    bf.on('done', (d) => { doneEvt = d; });

    await bf.run();

    expect(search.size).toBe(8);
    expect(embedder.embeddedTexts).toBe(8); // one embed per distinct item, no more
    expect(doneEvt).toEqual({ done: 8, total: 8 });
    // Monotonic progress, last one hits the total.
    expect(progress.at(-1)).toEqual({ done: 8, total: 8 });
    expect(progress.map((p) => p.done)).toEqual([0, 3, 6, 8]);

    // Semantic query works over the freshly backfilled vectors.
    const r = await search.query({ text: ITEMS[2].title, mode: 'semantic', minScore: 0.1 });
    expect(r.items[0].id).toBe('item-2');
  });

  it('clears the cursor once complete', async () => {
    const bf = createBackfill({ search, source, batchSize: 3, yield: microYield });
    await bf.run();
    expect(await store.get('private/state/search-backfill/cursor')).toBeNull();
  });
});

describe('backfill: kill + resume does NOT re-embed completed items', () => {
  it('the completed prefix contributes 0 new embeds on the resumed run', async () => {
    const store = createMemoryBackend();
    const source1 = seededSource(ITEMS);

    // Run 1 — pause after the first 4 items are done (batchSize 2 → 2 batches).
    const e1 = fakeEmbedder();
    const s1 = new PodSearch({ schema: SCHEMA, embedder: e1, hash, vectorStore: store });
    const bf1 = createBackfill({ search: s1, source: source1, batchSize: 2, yield: microYield });
    bf1.on('progress', ({ done }) => { if (done >= 4) bf1.pause(); });

    let pausedEvt = null;
    bf1.on('paused', (p) => { pausedEvt = p; });
    await bf1.run();

    expect(pausedEvt).toEqual({ done: 4, total: 8 });
    expect(e1.embeddedTexts).toBe(4); // only the first 4 embedded
    expect(source1.reads).toHaveLength(4); // and only the first 4 were even READ

    // Persisted cursor anchors the resume point.
    const cursorRec = await store.get('private/state/search-backfill/cursor');
    const cursor = JSON.parse(cursorRec.bytes);
    expect(cursor.done).toBe(4);

    // ── KILL: brand-new PodSearch + backfill, same underlying store ──
    const e2 = fakeEmbedder();
    const s2 = new PodSearch({ schema: SCHEMA, embedder: e2, hash, vectorStore: store });
    const source2 = seededSource(ITEMS);
    const bf2 = createBackfill({ search: s2, source: source2, batchSize: 2, yield: microYield });

    let done2 = null;
    bf2.on('done', (d) => { done2 = d; });
    await bf2.resume();

    // Everything is indexed after the resumed run. NB: `size` counts a single
    // instance's in-memory item docs; 52.23 persists *vectors*, so the proof
    // of completeness is the cursor draining to `total` + one vector record
    // per item in the shared store (the first 4 from run 1, the rest from run 2).
    expect(done2).toEqual({ done: 8, total: 8 });
    const itemRecords = await store.list('private/state/search-index/default/items/');
    expect(itemRecords).toHaveLength(8);

    // THE PROOF: the resumed run only touched the remaining 4 items.
    expect(e2.embeddedTexts).toBe(4);            // 0 embeds attributable to the completed prefix
    expect(source2.reads).toHaveLength(4);       // the completed 4 were never re-read
    // The completed uris are exactly the ones NOT re-read on resume.
    const completedUris = source1.reads;
    for (const uri of completedUris) {
      expect(source2.reads).not.toContain(uri);
    }

    // Total embed work across both runs == one per item, zero re-embeds.
    expect(e1.embeddedTexts + e2.embeddedTexts).toBe(8);
  });

  it('cursor survives even without a full restart (resume continues in place)', async () => {
    const store = createMemoryBackend();
    const source = seededSource(ITEMS);
    const embedder = fakeEmbedder();
    const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store });
    const bf = createBackfill({ search, source, batchSize: 3, yield: microYield });

    // Pause after the first batch.
    const off = bf.on('progress', ({ done }) => { if (done >= 3) bf.pause(); });
    await bf.run();
    expect(search.size).toBe(3);
    off();

    // Resume the SAME orchestrator → finishes the rest.
    await bf.resume();
    expect(search.size).toBe(8);
    expect(embedder.embeddedTexts).toBe(8); // still exactly one embed per item
  });
});

describe('backfill: pod-independence — pseudo-pod vs mocked PodClient', () => {
  it('drives a mocked PodClient-shaped source ({uri}[] list) identically', async () => {
    const store = createMemoryBackend();
    const embedder = fakeEmbedder();
    const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store });
    const source = mockPodClientSource(ITEMS);

    let doneEvt = null;
    const bf = createBackfill({ search, source, batchSize: 4, yield: microYield });
    bf.on('done', (d) => { doneEvt = d; });
    await bf.run();

    expect(search.size).toBe(8);
    expect(embedder.embeddedTexts).toBe(8);
    expect(doneEvt).toEqual({ done: 8, total: 8 });
  });

  it('drives a real @onderling/pseudo-pod source ({list, read}) with no embed store wire', async () => {
    // The pseudo-pod is BOTH the corpus (source) and, via its backend, the
    // vector store — proving one local store satisfies the whole flow.
    const backend = createMemoryBackend();
    const pod = createPseudoPod({ backend, mode: 'standalone', deviceId: 'laptop-1' });

    // Seed the pod with the corpus as JSON resources.
    for (const it of ITEMS) {
      await pod.write(`pseudo-pod://laptop-1/items/${it.id}`, it);
    }

    // Adapter: pseudo-pod.read returns { uri, bytes } → the item is `bytes`.
    const source = {
      list: (prefix) => pod.list(prefix),
      read: async (uri) => (await pod.read(uri)).bytes,
    };

    const embedder = fakeEmbedder();
    const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: backend });
    const bf = createBackfill({
      search,
      source,
      batchSize: 3,
      prefix: 'pseudo-pod://laptop-1/items/',
      yield: microYield,
    });

    let doneEvt = null;
    bf.on('done', (d) => { doneEvt = d; });
    await bf.run();

    expect(search.size).toBe(8);
    expect(embedder.embeddedTexts).toBe(8);
    expect(doneEvt).toEqual({ done: 8, total: 8 });
  });
});

describe('backfill: events + errors', () => {
  it('emits error { code } when a read fails, without throwing out of run()', async () => {
    const store = createMemoryBackend();
    const embedder = fakeEmbedder();
    const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store });
    const source = {
      async list() { return ['mem://a', 'mem://b']; },
      async read() { throw Object.assign(new Error('boom'), { code: 'E_SOURCE_READ' }); },
    };

    const errors = [];
    const bf = createBackfill({ search, source, batchSize: 2, yield: microYield });
    bf.on('error', (e) => errors.push(e));

    await expect(bf.run()).resolves.toBeUndefined(); // does not reject
    expect(errors).toEqual([{ code: 'E_SOURCE_READ' }]);
  });

  it('validates its wiring', () => {
    const store = createMemoryBackend();
    const search = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder(), hash, vectorStore: store });
    expect(() => createBackfill({ search })).toThrow(/source/);
    expect(() => createBackfill({ source: seededSource(ITEMS) })).toThrow(/search/);
    expect(() => createBackfill({ search, source: seededSource(ITEMS), batchSize: 0 })).toThrow(/batchSize/);
  });

  it('falls back to search.vectorStore when no cursorStore is injected', async () => {
    const store = createMemoryBackend();
    const embedder = fakeEmbedder();
    const search = new PodSearch({ schema: SCHEMA, embedder, hash, vectorStore: store });
    const source = seededSource(ITEMS);
    // No cursorStore passed → uses search.vectorStore for the cursor.
    const bf = createBackfill({ search, source, batchSize: 3, yield: microYield });
    const off = bf.on('progress', ({ done }) => { if (done >= 3) bf.pause(); });
    await bf.run();
    off();
    // Cursor landed in the search's own vector store.
    expect(await store.get('private/state/search-backfill/cursor')).not.toBeNull();
  });
});

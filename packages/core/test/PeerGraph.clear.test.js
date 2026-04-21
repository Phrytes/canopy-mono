/**
 * PeerGraph.clear() — wipes every peer record from the backend.
 * See EXTRACTION-PLAN.md Group M.
 */
import { describe, it, expect, vi } from 'vitest';
import { PeerGraph } from '../src/discovery/PeerGraph.js';

describe('PeerGraph.clear()', () => {
  it('removes all records and leaves all()/get() empty', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'a' });
    await graph.upsert({ pubKey: 'b' });
    await graph.upsert({ pubKey: 'c' });

    expect((await graph.all()).length).toBe(3);

    await graph.clear();

    expect(await graph.all()).toEqual([]);
    expect(await graph.get('a')).toBeNull();
    expect(await graph.get('b')).toBeNull();
    expect(await graph.get('c')).toBeNull();
  });

  it('only deletes keys under the peer: namespace, not unrelated backend entries', async () => {
    const store = new Map();
    const backend = {
      get:    async (k) => store.get(k) ?? null,
      set:    async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      list:   async () => [...store.keys()],
    };
    // seed a non-peer key to prove it survives
    await backend.set('unrelated:key', 'keep me');

    const graph = new PeerGraph({ storageBackend: backend });
    await graph.upsert({ pubKey: 'p1' });
    await graph.upsert({ pubKey: 'p2' });

    await graph.clear();

    expect(await backend.get('unrelated:key')).toBe('keep me');
    expect(await backend.get('peer:p1')).toBeNull();
  });

  it('emits a cleared event with the number of records removed', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'x' });
    await graph.upsert({ pubKey: 'y' });

    const listener = vi.fn();
    graph.on('cleared', listener);

    await graph.clear();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ count: 2 });
  });

  it('is a safe no-op on an empty graph', async () => {
    const graph = new PeerGraph();
    await expect(graph.clear()).resolves.toBeUndefined();
    expect(await graph.all()).toEqual([]);
  });
});

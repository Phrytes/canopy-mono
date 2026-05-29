import { describe, it, expect } from 'vitest';
import { createCirclePolicyStore, localStoragePolicyIo } from '../../src/v2/circlePolicyStore.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

describe('createCirclePolicyStore', () => {
  it('get() returns normalised defaults when nothing is stored', async () => {
    const store = createCirclePolicyStore({ load: async () => null });
    expect(await store.get('c1')).toEqual(DEFAULT_CIRCLE_POLICY);
  });

  it('update() deep-merges onto current and persists the normalised result', async () => {
    const mem = {};
    const store = createCirclePolicyStore({
      load: async (id) => mem[id] ?? null,
      save: async (id, p) => { mem[id] = p; },
    });
    await store.update('c1', { features: { tasks: true }, pod: 'shared' });
    const after = await store.update('c1', { features: { notes: true }, llmTool: 'local' });
    expect(after.features.tasks).toBe(true);  // preserved across edits
    expect(after.features.notes).toBe(true);
    expect(after.pod).toBe('shared');
    expect(after.llmTool).toBe('local');
    expect(mem.c1).toEqual(after);             // persisted
  });

  it('tolerates a throwing load (falls back to defaults)', async () => {
    const store = createCirclePolicyStore({ load: async () => { throw new Error('x'); } });
    expect(await store.get('c1')).toEqual(DEFAULT_CIRCLE_POLICY);
  });
});

describe('localStoragePolicyIo', () => {
  it('round-trips through a Storage-like backend', async () => {
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStoragePolicyIo(storage);
    await io.save('c1', { pod: 'shared' });
    expect(await io.load('c1')).toEqual({ pod: 'shared' });
    expect(map.has('cc.circlePolicy.c1')).toBe(true);
  });

  it('load returns null for missing / corrupt entries', async () => {
    const storage = { getItem: () => 'not json{', setItem: () => {} };
    expect(await localStoragePolicyIo(storage).load('c1')).toBeNull();
  });
});

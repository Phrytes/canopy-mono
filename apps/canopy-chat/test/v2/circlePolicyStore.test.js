import { describe, it, expect } from 'vitest';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
import { DEFAULT_CIRCLE_POLICY, DEFAULT_MEMBER_OVERRIDE } from '../../src/v2/circlePolicy.js';

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

describe('createMemberOverrideStore', () => {
  it('get() returns normalised defaults when nothing is stored', async () => {
    const store = createMemberOverrideStore({ load: async () => null });
    expect(await store.get('c1')).toEqual(DEFAULT_MEMBER_OVERRIDE);
  });

  it('update() deep-merges flowThrough and persists', async () => {
    const mem = {};
    const store = createMemberOverrideStore({
      load: async (id) => mem[id] ?? null,
      save: async (id, o) => { mem[id] = o; },
    });
    await store.update('c1', { chatOff: true, flowThrough: { tasksToPersonal: true } });
    const after = await store.update('c1', { flowThrough: { calendarToPersonal: true } });
    expect(after.chatOff).toBe(true);
    expect(after.flowThrough).toEqual({ tasksToPersonal: true, calendarToPersonal: true });
    expect(mem.c1).toEqual(after);
  });

  it('localStorageOverrideIo round-trips under its own key', async () => {
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStorageOverrideIo(storage);
    await io.save('c1', { chatOff: true });
    expect(await io.load('c1')).toEqual({ chatOff: true });
    expect(map.has('cc.circleOverride.c1')).toBe(true);
  });
});

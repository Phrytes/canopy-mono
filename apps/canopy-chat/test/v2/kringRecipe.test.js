// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  BLOCK_TYPES, EMPTY_RECIPE,
  normalizeRecipe, defaultConfigForBlock,
  addBlock, removeBlock, moveBlock, updateBlock,
  createKringRecipeStore, localStorageRecipeIo,
} from '../../src/v2/kringRecipe.js';

describe('kringRecipe · α.1a — pure model', () => {
  it('exposes the v2 §2 block palette in editor order', () => {
    expect(BLOCK_TYPES).toEqual([
      'announcement', 'noticeboard', 'agenda', 'rules', 'photo', 'text',
    ]);
  });

  it('EMPTY_RECIPE is the canonical empty shape', () => {
    expect(EMPTY_RECIPE).toEqual({ blocks: [] });
  });

  it('normalizeRecipe coerces junk to {blocks: []}', () => {
    expect(normalizeRecipe(null)).toEqual({ blocks: [] });
    expect(normalizeRecipe(undefined)).toEqual({ blocks: [] });
    expect(normalizeRecipe('nope')).toEqual({ blocks: [] });
    expect(normalizeRecipe({})).toEqual({ blocks: [] });
    expect(normalizeRecipe({ blocks: 'oops' })).toEqual({ blocks: [] });
  });

  it('normalizeRecipe drops unknown block types (forward-compat)', () => {
    const r = normalizeRecipe({ blocks: [
      { id: 'b1', type: 'announcement', config: { text: 'hi' } },
      { id: 'b2', type: 'future-block-from-v3', config: {} },
      { id: 'b3', type: 'photo', config: { src: '/x.jpg' } },
    ] });
    expect(r.blocks.map((b) => b.type)).toEqual(['announcement', 'photo']);
  });

  it('normalizeRecipe mints ids for blocks missing one', () => {
    const r = normalizeRecipe({ blocks: [
      { type: 'announcement', config: {} },
      { type: 'text', config: {} },
    ] });
    expect(r.blocks[0].id).toMatch(/^b-/);
    expect(r.blocks[1].id).toMatch(/^b-/);
    expect(r.blocks[0].id).not.toBe(r.blocks[1].id);
  });

  it('defaultConfigForBlock returns a fresh empty-ish object per type', () => {
    expect(defaultConfigForBlock('announcement')).toEqual({ text: '' });
    expect(defaultConfigForBlock('noticeboard')).toEqual({ limit: 5 });
    expect(defaultConfigForBlock('agenda')).toEqual({ limit: 5, horizonDays: 14 });
    expect(defaultConfigForBlock('rules')).toEqual({});
    expect(defaultConfigForBlock('photo')).toEqual({ src: '', caption: '' });
    expect(defaultConfigForBlock('text')).toEqual({ text: '' });
    expect(defaultConfigForBlock('not-a-type')).toEqual({});
  });
});

describe('kringRecipe · α.1a — block helpers', () => {
  it('addBlock appends with default config, returns NEW recipe (immutable)', () => {
    const r0 = EMPTY_RECIPE;
    const r1 = addBlock(r0, 'announcement');
    expect(r0.blocks).toHaveLength(0);
    expect(r1.blocks).toHaveLength(1);
    expect(r1.blocks[0]).toMatchObject({ type: 'announcement', config: { text: '' } });
    expect(r1.blocks[0].id).toMatch(/^b-/);
  });

  it('addBlock applies a config patch on top of defaults', () => {
    const r = addBlock(EMPTY_RECIPE, 'noticeboard', { limit: 10 });
    expect(r.blocks[0].config).toEqual({ limit: 10 });
  });

  it('addBlock throws on unknown block type', () => {
    expect(() => addBlock(EMPTY_RECIPE, 'nonsense')).toThrow(/unknown block type/);
  });

  it('removeBlock drops the matching id; no-op on miss', () => {
    let r = addBlock(EMPTY_RECIPE, 'announcement');
    r = addBlock(r, 'text');
    const targetId = r.blocks[0].id;
    const after = removeBlock(r, targetId);
    expect(after.blocks).toHaveLength(1);
    expect(after.blocks[0].type).toBe('text');
    const miss = removeBlock(after, 'b-doesnt-exist');
    expect(miss.blocks).toEqual(after.blocks);
  });

  it('moveBlock reorders to the requested index; clamps out-of-range', () => {
    let r = addBlock(EMPTY_RECIPE, 'announcement');
    r = addBlock(r, 'photo');
    r = addBlock(r, 'text');
    const lastId = r.blocks[2].id;
    const r2 = moveBlock(r, lastId, 0);
    expect(r2.blocks.map((b) => b.type)).toEqual(['text', 'announcement', 'photo']);

    const firstId = r2.blocks[0].id;
    const r3 = moveBlock(r2, firstId, 99);  // clamps to last
    expect(r3.blocks.map((b) => b.type)).toEqual(['announcement', 'photo', 'text']);

    const noop = moveBlock(r3, 'b-missing', 0);
    expect(noop).toEqual(r3);
  });

  it('updateBlock shallow-merges configPatch on the matching block', () => {
    const r = addBlock(EMPTY_RECIPE, 'photo', { src: '/a.jpg', caption: 'first' });
    const id = r.blocks[0].id;
    const r2 = updateBlock(r, id, { caption: 'updated' });
    expect(r2.blocks[0].config).toEqual({ src: '/a.jpg', caption: 'updated' });
  });

  it('updateBlock no-ops when blockId is missing', () => {
    const r = addBlock(EMPTY_RECIPE, 'text', { text: 'hi' });
    const r2 = updateBlock(r, 'b-missing', { text: 'changed' });
    expect(r2).toEqual(r);
  });
});

describe('kringRecipe · α.1a — store', () => {
  it('createKringRecipeStore.get returns empty when load yields null', async () => {
    const store = createKringRecipeStore({ io: { load: async () => null } });
    expect(await store.get('g1')).toEqual({ blocks: [] });
  });

  it('createKringRecipeStore.get normalizes legacy / dirty payloads', async () => {
    const store = createKringRecipeStore({ io: {
      load: async () => ({ blocks: [
        { type: 'announcement', config: { text: 'hi' } },  // no id → minted
        { type: 'garbage-block' },                          // dropped
      ] }),
    } });
    const r = await store.get('g1');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe('announcement');
  });

  it('store.set normalizes + persists via save', async () => {
    const captured = {};
    const store = createKringRecipeStore({ io: {
      load: async () => null,
      save: async (id, recipe) => { captured[id] = recipe; },
    } });
    const r = await store.set('g1', addBlock(EMPTY_RECIPE, 'text'));
    expect(captured.g1.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe('text');
  });

  it('store.update accepts a mutator function over current state', async () => {
    let stored = { blocks: [] };
    const store = createKringRecipeStore({ io: {
      load: async () => stored,
      save: async (_id, r) => { stored = r; },
    } });
    await store.update('g1', (cur) => addBlock(cur, 'announcement'));
    await store.update('g1', (cur) => addBlock(cur, 'noticeboard'));
    const final = await store.get('g1');
    expect(final.blocks.map((b) => b.type)).toEqual(['announcement', 'noticeboard']);
  });

  it('store.get tolerates a load() that throws', async () => {
    const store = createKringRecipeStore({ io: { load: async () => { throw new Error('disk gone'); } } });
    expect(await store.get('g1')).toEqual({ blocks: [] });
  });
});

describe('kringRecipe · α.1a — localStorageRecipeIo', () => {
  it('round-trips through localStorage under the expected key', async () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    const io = localStorageRecipeIo(storage);
    await io.save('g42', { blocks: [{ id: 'b1', type: 'text', config: { text: 'hi' } }] });
    expect(mem.has('cc.circleRecipe.g42')).toBe(true);
    const r = await io.load('g42');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe('text');
  });

  it('load returns null when key is absent', async () => {
    const io = localStorageRecipeIo({ getItem: () => null, setItem: () => {} });
    expect(await io.load('nope')).toBeNull();
  });

  it('save swallows quota / disabled-storage errors', async () => {
    const io = localStorageRecipeIo({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    await expect(io.save('g1', EMPTY_RECIPE)).resolves.toBeUndefined();
  });
});

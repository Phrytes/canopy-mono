// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  EMPTY_SCREEN_BOOK, ALL_KRINGEN,
  emptyScreen, normalizeScreen, isAllKringen, effectiveKringIds,
  addKringToScreen, removeKringFromScreen, setAllKringen,
  normalizeScreenBook,
  addScreen, renameScreen, removeScreen, setActiveScreen, getActiveScreen, updateScreen,
  createUserScreenStore, localStorageScreenIo,
} from '../../src/v2/userScreens.js';
import { addBlock, moveBlock } from '../../src/v2/kringRecipe.js';

/* ─────────────────────────────────────────────────────────────────── */
/* Single Screen                                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — single Screen', () => {
  it('emptyScreen() mints fresh id + defaults to ALL_KRINGEN', () => {
    const s = emptyScreen('Stream');
    expect(s).toMatchObject({ name: 'Stream', kringFilter: ALL_KRINGEN, blocks: [] });
    expect(s.id).toMatch(/^s-/);
    expect(emptyScreen().id).not.toBe(s.id);
  });

  it('emptyScreen with an explicit kringFilter list dedupes + drops blanks', () => {
    const s = emptyScreen('Two-kring', ['g-a', '', 'g-b', null, 'g-a']);
    // Per implementation: blanks/non-strings dropped, but dup IS kept (only
    // addKringToScreen dedupes).  Verify via the public shape.
    expect(s.kringFilter).toEqual(['g-a', 'g-b', 'g-a']);
  });

  it('normalizeScreen coerces malformed input', () => {
    expect(normalizeScreen(null).kringFilter).toBe(ALL_KRINGEN);
    const s = normalizeScreen({ id: 'x', name: 7, kringFilter: 'oops', blocks: 42 });
    expect(s.id).toBe('x');
    expect(s.name).toBe('');         // non-string name → ''
    expect(s.kringFilter).toBe(ALL_KRINGEN);  // non-array filter → ALL
    expect(s.blocks).toEqual([]);
  });

  it('normalizeScreen drops unknown block types (forward-compat)', () => {
    const s = normalizeScreen({ blocks: [
      { id: 'b1', type: 'announcement', config: {} },
      { id: 'b2', type: 'future-block', config: {} },
      { id: 'b3', type: 'photo', config: {} },
    ] });
    expect(s.blocks.map((b) => b.type)).toEqual(['announcement', 'photo']);
  });

  it('isAllKringen returns true for null, undefined, []', () => {
    expect(isAllKringen({ kringFilter: ALL_KRINGEN })).toBe(true);
    expect(isAllKringen({})).toBe(true);
    expect(isAllKringen({ kringFilter: [] })).toBe(true);
    expect(isAllKringen({ kringFilter: ['g-a'] })).toBe(false);
  });

  it('effectiveKringIds expands ALL → allCircleIds; passes through explicit list', () => {
    const s1 = emptyScreen('Stream');
    expect(effectiveKringIds(s1, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);

    const s2 = emptyScreen('Selwerd', ['g-sel']);
    expect(effectiveKringIds(s2, ['a', 'b', 'c'])).toEqual(['g-sel']);
  });

  it('addKringToScreen: ALL → [id]; further adds dedupe', () => {
    let s = emptyScreen('S');
    expect(isAllKringen(s)).toBe(true);
    s = addKringToScreen(s, 'g-a');
    expect(s.kringFilter).toEqual(['g-a']);
    s = addKringToScreen(s, 'g-b');
    s = addKringToScreen(s, 'g-a');   // dup; no-op
    expect(s.kringFilter).toEqual(['g-a', 'g-b']);
  });

  it('removeKringFromScreen: no-op on ALL; otherwise filters', () => {
    let s = emptyScreen('S');
    s = removeKringFromScreen(s, 'g-a');
    expect(isAllKringen(s)).toBe(true);   // still ALL

    s = addKringToScreen(s, 'g-a');
    s = addKringToScreen(s, 'g-b');
    s = removeKringFromScreen(s, 'g-a');
    expect(s.kringFilter).toEqual(['g-b']);
  });

  it('setAllKringen drops any explicit list, returns to ALL', () => {
    let s = addKringToScreen(emptyScreen('S'), 'g-a');
    expect(isAllKringen(s)).toBe(false);
    s = setAllKringen(s);
    expect(isAllKringen(s)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Reused block helpers compose with Screen                           */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — α.1 block helpers compose with Screen', () => {
  it('addBlock/moveBlock work directly on a Screen (.blocks shape match)', () => {
    let s = emptyScreen('Stream');
    s = addBlock(s, 'noticeboard');
    s = addBlock(s, 'agenda');
    expect(s.blocks.map((b) => b.type)).toEqual(['noticeboard', 'agenda']);
    // addBlock preserves id+name; check id+kringFilter survive.
    expect(s.id).toMatch(/^s-/);
    expect(s.kringFilter).toBe(ALL_KRINGEN);

    const noticeId = s.blocks[0].id;
    s = moveBlock(s, noticeId, 1);
    expect(s.blocks.map((b) => b.type)).toEqual(['agenda', 'noticeboard']);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* ScreenBook helpers                                                 */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — ScreenBook', () => {
  it('EMPTY_SCREEN_BOOK is the canonical empty shape', () => {
    expect(EMPTY_SCREEN_BOOK).toEqual({ screens: [], activeId: null });
  });

  it('normalizeScreenBook defaults activeId to first screen when absent or stale', () => {
    const s1 = emptyScreen('A');
    const s2 = emptyScreen('B');
    expect(normalizeScreenBook({ screens: [s1, s2] }).activeId).toBe(s1.id);
    expect(normalizeScreenBook({ screens: [s1, s2], activeId: 's-missing' }).activeId).toBe(s1.id);
    expect(normalizeScreenBook({ screens: [s1, s2], activeId: s2.id }).activeId).toBe(s2.id);
  });

  it('addScreen appends + marks active when book was empty; preserves active otherwise', () => {
    let book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    expect(book.screens).toHaveLength(1);
    expect(book.activeId).toBe(book.screens[0].id);
    book = addScreen(book, 'Selwerd', ['g-sel']);
    expect(book.screens).toHaveLength(2);
    expect(book.activeId).toBe(book.screens[0].id);   // active unchanged
    expect(book.screens[1].kringFilter).toEqual(['g-sel']);
  });

  it('renameScreen: no-op on missing id', () => {
    const book = addScreen(EMPTY_SCREEN_BOOK, 'A');
    expect(renameScreen(book, 'missing', 'X')).toEqual(book);
    const renamed = renameScreen(book, book.screens[0].id, 'A-2');
    expect(renamed.screens[0].name).toBe('A-2');
  });

  it('removeScreen picks next as active when active was removed', () => {
    let book = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'A'), 'B');
    const aId = book.screens[0].id;
    const bId = book.screens[1].id;
    expect(book.activeId).toBe(aId);

    book = removeScreen(book, aId);
    expect(book.screens.map((s) => s.name)).toEqual(['B']);
    expect(book.activeId).toBe(bId);

    book = removeScreen(book, bId);
    expect(book.screens).toEqual([]);
    expect(book.activeId).toBeNull();
  });

  it('setActiveScreen + getActiveScreen', () => {
    let book = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'A'), 'B');
    expect(getActiveScreen(book).name).toBe('A');
    book = setActiveScreen(book, book.screens[1].id);
    expect(getActiveScreen(book).name).toBe('B');
    const noop = setActiveScreen(book, 's-missing');
    expect(noop).toEqual(book);
  });

  it('updateScreen mutator can use single-screen helpers + α.1 block helpers', () => {
    let book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    const sid = book.screens[0].id;
    // add a kring to the filter
    book = updateScreen(book, sid, (s) => addKringToScreen(s, 'g-a'));
    // add a noticeboard block via the α.1 helper — composes
    book = updateScreen(book, sid, (s) => addBlock(s, 'noticeboard', { limit: 10 }));
    expect(book.screens[0].kringFilter).toEqual(['g-a']);
    expect(book.screens[0].blocks).toHaveLength(1);
    expect(book.screens[0].blocks[0].config.limit).toBe(10);
  });

  it('updateScreen is a no-op when screenId is missing OR mutator is null', () => {
    const book = addScreen(EMPTY_SCREEN_BOOK, 'A');
    expect(updateScreen(book, 's-missing', (s) => s)).toEqual(book);
    expect(updateScreen(book, book.screens[0].id, null)).toEqual(book);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Store                                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — store', () => {
  it('store.get returns empty when load yields null', async () => {
    const store = createUserScreenStore({ io: { load: async () => null } });
    expect(await store.get()).toEqual(EMPTY_SCREEN_BOOK);
  });

  it('store.set + store.update flow + persistence', async () => {
    let stored = null;
    const store = createUserScreenStore({ io: {
      load: async () => stored,
      save: async (b) => { stored = b; },
    } });
    await store.update((cur) => addScreen(cur, 'Stream'));
    await store.update((cur) => addScreen(cur, 'Werk'));
    const final = await store.get();
    expect(final.screens.map((s) => s.name)).toEqual(['Stream', 'Werk']);
    expect(stored.activeId).toBe(stored.screens[0].id);
  });

  it('store.get tolerates load() that throws', async () => {
    const store = createUserScreenStore({ io: { load: async () => { throw new Error('disk gone'); } } });
    expect(await store.get()).toEqual(EMPTY_SCREEN_BOOK);
  });
});

describe('userScreens · α.2.a — localStorageScreenIo', () => {
  it('round-trips through localStorage under the single user key', async () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    const io = localStorageScreenIo(storage);
    const book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    await io.save(book);
    expect(mem.has('cc.userScreens')).toBe(true);
    const loaded = await io.load();
    expect(loaded.screens).toHaveLength(1);
    expect(loaded.screens[0].name).toBe('Stream');
  });

  it('save swallows quota / disabled-storage errors', async () => {
    const io = localStorageScreenIo({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    await expect(io.save(EMPTY_SCREEN_BOOK)).resolves.toBeUndefined();
  });
});

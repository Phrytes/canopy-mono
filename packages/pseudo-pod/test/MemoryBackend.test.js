/**
 * MemoryBackend — unit tests.
 *
 * Covers:
 *   - get/put round-trip with auto-generated etags.
 *   - put with explicit etag is preserved.
 *   - delete removes the entry + fires subscribers.
 *   - list returns keys-with-prefix, sorted.
 *   - subscribe by prefix fires on matching writes only.
 *   - subscribe unsubscribe stops callbacks.
 *   - listDirty / subscribeDirty behaviour.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '../src/MemoryBackend.js';

describe('MemoryBackend.get/put', () => {
  it('round-trips a record + assigns an etag', async () => {
    const b = createMemoryBackend();
    const etag = await b.put('a', { x: 1 });
    expect(typeof etag).toBe('string');
    const rec = await b.get('a');
    expect(rec).toEqual({ bytes: { x: 1 }, etag });
  });

  it('preserves caller-supplied etag', async () => {
    const b = createMemoryBackend();
    const etag = await b.put('a', 'hello', '"v3"');
    expect(etag).toBe('"v3"');
    expect((await b.get('a'))?.etag).toBe('"v3"');
  });

  it('overwrites on second put and yields a new etag', async () => {
    const b = createMemoryBackend();
    const e1 = await b.put('a', 1);
    const e2 = await b.put('a', 2);
    expect(e2).not.toBe(e1);
    expect((await b.get('a'))?.bytes).toBe(2);
  });

  it('returns null for missing keys', async () => {
    const b = createMemoryBackend();
    expect(await b.get('nope')).toBe(null);
  });
});

describe('MemoryBackend.delete', () => {
  it('removes the entry', async () => {
    const b = createMemoryBackend();
    await b.put('a', 1);
    await b.delete('a');
    expect(await b.get('a')).toBe(null);
  });

  it('is a no-op for missing keys', async () => {
    const b = createMemoryBackend();
    await b.delete('nope');
    expect(b._size()).toBe(0);
  });
});

describe('MemoryBackend.list', () => {
  it('returns keys matching the prefix, sorted', async () => {
    const b = createMemoryBackend();
    await b.put('pseudo-pod://x/c', 1);
    await b.put('pseudo-pod://x/a', 1);
    await b.put('pseudo-pod://x/b', 1);
    await b.put('pseudo-pod://y/z', 1);
    expect(await b.list('pseudo-pod://x/')).toEqual([
      'pseudo-pod://x/a',
      'pseudo-pod://x/b',
      'pseudo-pod://x/c',
    ]);
  });

  it('returns empty when no keys match', async () => {
    const b = createMemoryBackend();
    expect(await b.list('nope')).toEqual([]);
  });
});

describe('MemoryBackend.subscribe', () => {
  it('fires on matching-prefix writes', async () => {
    const b = createMemoryBackend();
    const events = [];
    const unsub = b.subscribe('pseudo-pod://x/', (e) => events.push(e));

    await b.put('pseudo-pod://x/a', 1);
    await b.put('pseudo-pod://y/b', 1);
    await b.put('pseudo-pod://x/c', 1);

    expect(events.map(e => e.key)).toEqual([
      'pseudo-pod://x/a',
      'pseudo-pod://x/c',
    ]);
    expect(events.every(e => e.op === 'put')).toBe(true);
    expect(events.every(e => typeof e.etag === 'string')).toBe(true);

    unsub();
    await b.put('pseudo-pod://x/d', 1);
    expect(events).toHaveLength(2);
  });

  it('fires for delete events too', async () => {
    const b = createMemoryBackend();
    const events = [];
    b.subscribe('a/', (e) => events.push(e));
    await b.put('a/1', 1);
    await b.delete('a/1');
    expect(events.map(e => e.op)).toEqual(['put', 'delete']);
  });

  it('callback errors are swallowed (one bad subscriber does not break siblings)', async () => {
    const b = createMemoryBackend();
    const good = [];
    b.subscribe('a/', () => { throw new Error('bang'); });
    b.subscribe('a/', (e) => good.push(e));
    await b.put('a/1', 1);
    expect(good).toHaveLength(1);
  });
});

describe('MemoryBackend.dirty surface', () => {
  it('listDirty / subscribeDirty round-trip', async () => {
    const b = createMemoryBackend();
    const events = [];
    b.subscribeDirty((e) => events.push(e));

    b._markDirty('a');
    b._markDirty('b');
    b._markDirty('a');   // idempotent — no second event

    expect(await b.listDirty()).toEqual(['a', 'b']);
    expect(events).toEqual([
      { op: 'dirty', key: 'a' },
      { op: 'dirty', key: 'b' },
    ]);

    b._markClean('a');
    expect(await b.listDirty()).toEqual(['b']);
    expect(events.at(-1)).toEqual({ op: 'clean', key: 'a' });
  });

  it('delete also cleans dirty flag', async () => {
    const b = createMemoryBackend();
    await b.put('a', 1);
    b._markDirty('a');
    expect(await b.listDirty()).toEqual(['a']);
    await b.delete('a');
    expect(await b.listDirty()).toEqual([]);
  });
});

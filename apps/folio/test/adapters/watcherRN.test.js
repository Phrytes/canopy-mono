/**
 * watcherRN.test.js — interval-poll watcher tests.
 *
 * We exercise the diffing logic via `_walkOnce()` (synchronous, no timer)
 * and via `start()` followed by `_tickForTest()` (drives the polling
 * pipeline without waiting on real time).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createWatcherRN, DEFAULT_POLL_INTERVAL_MS } from '../../src/adapters/watcherRN.js';

/**
 * Ultra-tiny in-memory FS adapter — enough surface for the watcher's
 * walk path (`readdir({ withFileTypes: true })` + `stat`).
 */
function buildMemoryFs() {
  /** @type {Map<string, { kind: 'file', size: number, mtimeMs: number } | { kind: 'dir' }>} */
  const tree = new Map();
  tree.set('/root', { kind: 'dir' });

  function entriesUnder(dir) {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const out = [];
    for (const [k, v] of tree) {
      if (!k.startsWith(prefix)) continue;
      const tail = k.slice(prefix.length);
      if (!tail || tail.includes('/')) continue;
      out.push({
        name: tail,
        isFile: () => v.kind === 'file',
        isDirectory: () => v.kind === 'dir',
      });
    }
    return out;
  }

  return {
    tree,
    fs: {
      async readdir(absDir, opts = {}) {
        const e = tree.get(absDir);
        if (!e || e.kind !== 'dir') {
          const err = new Error(`ENOENT: ${absDir}`); err.code = 'ENOENT'; throw err;
        }
        const items = entriesUnder(absDir);
        return opts.withFileTypes ? items : items.map((x) => x.name);
      },
      async stat(absPath) {
        const e = tree.get(absPath);
        if (!e) {
          const err = new Error(`ENOENT: ${absPath}`); err.code = 'ENOENT'; throw err;
        }
        return {
          size:    e.kind === 'file' ? e.size    : 0,
          mtimeMs: e.kind === 'file' ? e.mtimeMs : 0,
          isFile: () => e.kind === 'file',
          isDirectory: () => e.kind === 'dir',
        };
      },
    },
    addFile(abs, size, mtimeMs) { tree.set(abs, { kind: 'file', size, mtimeMs }); },
    addDir(abs)                 { tree.set(abs, { kind: 'dir' }); },
    delete(abs)                 { tree.delete(abs); },
    update(abs, size, mtimeMs)  { tree.set(abs, { kind: 'file', size, mtimeMs }); },
  };
}

describe('createWatcherRN — surface', () => {
  it('rejects calls without an fs adapter', () => {
    expect(() => createWatcherRN({})).toThrow(/fs adapter/);
  });
  it('exposes start() + _walkOnce', () => {
    const { fs } = buildMemoryFs();
    const w = createWatcherRN({ fs });
    expect(typeof w.start).toBe('function');
    expect(typeof w._walkOnce).toBe('function');
  });
});

describe('watcherRN._walkOnce — directory walking', () => {
  it('returns an empty Map for an empty root', async () => {
    const { fs } = buildMemoryFs();
    const w = createWatcherRN({ fs });
    const m = await w._walkOnce('/root');
    expect(m.size).toBe(0);
  });

  it('returns one entry per file with (mtimeMs, size)', async () => {
    const m = buildMemoryFs();
    m.addFile('/root/a.md', 10, 1234);
    m.addFile('/root/b.md', 20, 5678);
    const w = createWatcherRN({ fs: m.fs });
    const result = await w._walkOnce('/root');
    expect(result.size).toBe(2);
    expect(result.get('/root/a.md')).toEqual({ size: 10, mtimeMs: 1234 });
    expect(result.get('/root/b.md')).toEqual({ size: 20, mtimeMs: 5678 });
  });

  it('recurses into subdirectories', async () => {
    const m = buildMemoryFs();
    m.addDir('/root/sub');
    m.addFile('/root/a.md', 10, 1);
    m.addFile('/root/sub/b.md', 20, 2);
    const w = createWatcherRN({ fs: m.fs });
    const result = await w._walkOnce('/root');
    expect(result.size).toBe(2);
    expect(result.has('/root/sub/b.md')).toBe(true);
  });

  it('honours the `ignored` predicate', async () => {
    const m = buildMemoryFs();
    m.addDir('/root/.folio');
    m.addFile('/root/a.md', 10, 1);
    m.addFile('/root/.folio/state.json', 5, 1);
    const w = createWatcherRN({ fs: m.fs });
    const result = await w._walkOnce('/root', (p) => p.includes('/.folio'));
    expect(result.has('/root/a.md')).toBe(true);
    expect(result.has('/root/.folio/state.json')).toBe(false);
  });
});

describe('watcherRN.start — diffing across ticks', () => {
  let m, watcher, events;

  beforeEach(() => {
    m = buildMemoryFs();
    watcher = createWatcherRN({ fs: m.fs, intervalMs: DEFAULT_POLL_INTERVAL_MS });
    events = [];
  });

  it('emits "add" for a new file appearing on a later tick', async () => {
    const handle = await watcher.start({
      root:    '/root',
      onEvent: (ev) => events.push(ev),
    });
    m.addFile('/root/new.md', 5, 100);
    await handle._tickForTest();
    await handle.stop();
    expect(events).toEqual([{ event: 'add', absPath: '/root/new.md' }]);
  });

  it('emits "change" when (mtimeMs, size) differ on the next tick', async () => {
    m.addFile('/root/a.md', 10, 1);
    const handle = await watcher.start({
      root:    '/root',
      onEvent: (ev) => events.push(ev),
    });
    m.update('/root/a.md', 12, 2);
    await handle._tickForTest();
    await handle.stop();
    expect(events).toEqual([{ event: 'change', absPath: '/root/a.md' }]);
  });

  it('emits "unlink" when a file disappears between ticks', async () => {
    m.addFile('/root/a.md', 10, 1);
    const handle = await watcher.start({
      root:    '/root',
      onEvent: (ev) => events.push(ev),
    });
    m.delete('/root/a.md');
    await handle._tickForTest();
    await handle.stop();
    expect(events).toEqual([{ event: 'unlink', absPath: '/root/a.md' }]);
  });

  it('does not emit anything when nothing changes', async () => {
    m.addFile('/root/a.md', 10, 1);
    const handle = await watcher.start({
      root:    '/root',
      onEvent: (ev) => events.push(ev),
    });
    await handle._tickForTest();
    await handle.stop();
    expect(events).toEqual([]);
  });

  it('stop() halts further ticks', async () => {
    m.addFile('/root/a.md', 10, 1);
    const handle = await watcher.start({
      root:    '/root',
      onEvent: (ev) => events.push(ev),
    });
    await handle.stop();
    // After stop(), even a manual tick is a no-op (the early-return
    // guard inside `tick`).
    m.update('/root/a.md', 12, 2);
    await handle._tickForTest();
    expect(events).toEqual([]);
  });
});

/**
 * LocalFolderSource tests.
 *
 * Exercises the substrate against a real Node temp directory for the
 * scan path; a stubbed watcher for live updates (because `fs.watch`
 * timing varies across Linux/macOS/Windows enough to make CI flaky).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodeFs from 'node:fs/promises';
import nodePath from 'node:path';
import nodeOs from 'node:os';

import { LocalFolderSource } from '../src/sources/LocalFolderSource.js';

let tmp;
let stubWatcher;
let triggerChange;

function makeStubWatcher() {
  let onChange = null;
  const close = vi.fn();
  return {
    factory: (_root, cb) => { onChange = cb; return { close }; },
    fire:    (absPath) => onChange?.(absPath),
    close,
  };
}

beforeEach(async () => {
  tmp = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'lfs-test-'));
  stubWatcher = makeStubWatcher();
  triggerChange = stubWatcher.fire;
});

afterEach(async () => {
  await nodeFs.rm(tmp, { recursive: true, force: true });
});

describe('LocalFolderSource — initial scan', () => {
  it('emits one item per file at start()', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'a.md'), 'hello');
    await nodeFs.writeFile(nodePath.join(tmp, 'b.txt'), 'world');

    const items = [];
    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    src.onItem(async (it) => items.push(it));
    await src.start();
    await src.stop();

    items.sort((a, b) => a.relPath.localeCompare(b.relPath));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      relPath: 'a.md', content: 'hello', size: 5, contentType: 'text/markdown',
    });
    expect(items[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(items[1]).toMatchObject({
      relPath: 'b.txt', content: 'world', contentType: 'text/plain',
    });
  });

  it('walks nested directories with POSIX relPaths', async () => {
    await nodeFs.mkdir(nodePath.join(tmp, 'sub', 'deeper'), { recursive: true });
    await nodeFs.writeFile(nodePath.join(tmp, 'sub', 'one.md'),         'one');
    await nodeFs.writeFile(nodePath.join(tmp, 'sub', 'deeper', 'two.md'), 'two');

    const items = [];
    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    src.onItem(async (it) => items.push(it));
    await src.start();
    await src.stop();

    const paths = items.map((i) => i.relPath).sort();
    expect(paths).toEqual(['sub/deeper/two.md', 'sub/one.md']);
  });

  it('skips dotfiles + dotdirs by default', async () => {
    await nodeFs.mkdir(nodePath.join(tmp, '.git'), { recursive: true });
    await nodeFs.writeFile(nodePath.join(tmp, '.git', 'HEAD'),     'ref: ...');
    await nodeFs.writeFile(nodePath.join(tmp, '.DS_Store'),         'macos');
    await nodeFs.writeFile(nodePath.join(tmp, 'visible.md'),        'ok');

    const items = [];
    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    src.onItem(async (it) => items.push(it));
    await src.start();
    await src.stop();

    expect(items.map((i) => i.relPath)).toEqual(['visible.md']);
  });

  it('honours custom shouldInclude', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'keep.md'),  'k');
    await nodeFs.writeFile(nodePath.join(tmp, 'drop.bak'), 'd');

    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      shouldInclude: (rel) => !rel.endsWith('.bak'),
      watcherFactory: stubWatcher.factory,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();
    await src.stop();

    expect(items.map((i) => i.relPath)).toEqual(['keep.md']);
  });

  it('honours custom contentTypeFor', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'a.unknownext'), 'x');
    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      contentTypeFor: () => 'application/x-custom',
      watcherFactory: stubWatcher.factory,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();
    await src.stop();

    expect(items[0].contentType).toBe('application/x-custom');
  });

  it('drain() returns all enqueued items and empties the queue', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'one.md'), 'one');
    await nodeFs.writeFile(nodePath.join(tmp, 'two.md'), 'two');

    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    await src.start();
    const drained1 = await src.drain();
    const drained2 = await src.drain();
    await src.stop();

    expect(drained1).toHaveLength(2);
    expect(drained2).toHaveLength(0);
  });
});

// Real timers + small real waits.  Fake timers + real Node fs don't
// compose: advanceTimersByTimeAsync flushes microtasks, but fs.readFile
// + fs.stat (real I/O) take real time to settle.  Keep these tests
// fast by using short debounce windows.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('LocalFolderSource — live updates', () => {
  it('debounces multiple watcher events for the same path', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'live.md'), 'initial');

    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      watcherFactory: stubWatcher.factory,
      debounceMs: 30,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();
    // Initial scan emitted one.
    expect(items).toHaveLength(1);

    // Editor saves the file in two writes — three watcher events.
    await nodeFs.writeFile(nodePath.join(tmp, 'live.md'), 'edited');
    triggerChange(nodePath.join(tmp, 'live.md'));
    triggerChange(nodePath.join(tmp, 'live.md'));
    triggerChange(nodePath.join(tmp, 'live.md'));

    // Before debounce expires — no new emit.
    expect(items).toHaveLength(1);

    // After debounce expires — exactly one new emit.
    await sleep(80);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ relPath: 'live.md', content: 'edited' });

    await src.stop();
  });

  it('stop() clears pending debounce timers (no emit after stop)', async () => {
    await nodeFs.writeFile(nodePath.join(tmp, 'a.md'), 'a');
    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      watcherFactory: stubWatcher.factory,
      debounceMs: 30,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();
    const initialCount = items.length;

    triggerChange(nodePath.join(tmp, 'a.md'));
    await src.stop();
    await sleep(80);

    expect(items.length).toBe(initialCount);
  });

  it('skips watcher events for paths outside the root', async () => {
    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      watcherFactory: stubWatcher.factory,
      debounceMs: 20,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();

    triggerChange('/some/other/path/file.md');
    await sleep(60);

    expect(items).toHaveLength(0);
    await src.stop();
  });

  it('skips events for files that no longer exist', async () => {
    const items = [];
    const src = new LocalFolderSource({
      root: tmp,
      watcherFactory: stubWatcher.factory,
      debounceMs: 20,
    });
    src.onItem(async (it) => items.push(it));
    await src.start();

    triggerChange(nodePath.join(tmp, 'never-existed.md'));
    await sleep(60);

    expect(items).toHaveLength(0);
    await src.stop();
  });
});

describe('LocalFolderSource — lifecycle', () => {
  it('start() is idempotent', async () => {
    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    await src.start();
    await src.start();
    await src.stop();
  });

  it('stop() is idempotent and closes the watcher', async () => {
    const src = new LocalFolderSource({ root: tmp, watcherFactory: stubWatcher.factory });
    await src.start();
    await src.stop();
    await src.stop();
    expect(stubWatcher.close).toHaveBeenCalledTimes(1);
  });

  it('throws when constructed without root', () => {
    expect(() => new LocalFolderSource({})).toThrow();
    expect(() => new LocalFolderSource({ root: '' })).toThrow();
  });
});

describe('LocalFolderSource — SyncEngine integration', () => {
  it('feeds items into SyncEngine end-to-end', async () => {
    const { SyncEngine } = await import('../src/SyncEngine.js');
    const { InMemoryBackend } = await import('../src/backends/InMemoryBackend.js');

    await nodeFs.writeFile(nodePath.join(tmp, 'note.md'), '# hello');

    const source  = new LocalFolderSource({
      root: tmp,
      watcherFactory: stubWatcher.factory,
    });
    const backend = new InMemoryBackend();
    const engine  = new SyncEngine({
      source, backend, podRoot: 'https://pod.example/folio',
    });

    await engine.start();
    // SyncEngine.start() registers an onItem handler before calling
    // source.start(), so the initial scan delivers items through the
    // engine directly — syncOnce() is a no-op here.
    await engine.stop();

    const uris = await backend.list();
    expect(uris).toEqual(['https://pod.example/folio/note.md']);
    const record = await backend.get(uris[0]);
    expect(record).toMatchObject({ kind: 'direct', content: '# hello', contentType: 'text/markdown' });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyncEngine } from '../src/SyncEngine.js';
import { hasConflictMarkers } from '../src/applyConflict.js';

const POD_ROOT = 'https://alice.example/notes/';

// ── Mock PodClient ──────────────────────────────────────────────────────────
//
// Mirrors the surface SyncEngine consumes:
//   .read(uri, { decode })  → { content, contentType, lastModified, etag, size }
//   .write(uri, content, { contentType }) → { uri, ... }
//   .list(containerUri)     → { container, entries: [{ uri, type }] }
//   .delete(uri)
//   .deleteLocal(uri)       (tombstone)
//
// Backed by an in-memory map.  Containers are inferred from the resource URIs.

class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();      // uri → { content: string|Uint8Array, contentType, lastModified, etag, size }
    this.tombstones = new Set();
    this.listCalls  = 0;
    this.writeCalls = 0;
    this.readCalls  = 0;
    this._etagCounter = 0;
  }
  _seed(uri, content, contentType = 'text/markdown') {
    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
    this.store.set(uri, {
      content,
      contentType,
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    });
  }
  async read(uri, opts = {}) {
    this.readCalls++;
    const r = this.store.get(uri);
    if (!r) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let content = r.content;
    if (opts.decode === 'string') {
      if (content instanceof Uint8Array) content = new TextDecoder().decode(content);
    } else if (opts.decode === 'bytes') {
      if (typeof content === 'string') content = new TextEncoder().encode(content);
    }
    return { ...r, content };
  }
  async write(uri, content, opts = {}) {
    this.writeCalls++;
    const bytes = content instanceof Uint8Array
      ? content
      : (typeof content === 'string' ? new TextEncoder().encode(content) : new TextEncoder().encode(JSON.stringify(content)));
    const stored = {
      content,
      contentType: opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    };
    this.store.set(uri, stored);
    return { uri, ...stored };
  }
  async list(containerUri, _opts = {}) {
    this.listCalls++;
    const container = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nestedContainers = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slashIdx = tail.indexOf('/');
      if (slashIdx === -1) {
        direct.set(k, 'resource');
      } else {
        nestedContainers.add(`${container}${tail.slice(0, slashIdx)}/`);
      }
    }
    const entries = [
      ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
      ...[...nestedContainers].map((uri) => ({ uri, type: 'container' })),
    ];
    return { container, entries };
  }
  async delete(uri) {
    this.store.delete(uri);
    this.tombstones.delete(uri);
  }
  async deleteLocal(uri) {
    this.tombstones.add(uri);
  }
  async clearTombstone(uri) {
    this.tombstones.delete(uri);
  }
  on() {} // emitter stub
  off() {}
  emit() {}
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let localRoot, pod;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-sync-'));
  pod = new MockPodClient(POD_ROOT);
});
afterEach(async () => { await fs.rm(localRoot, { recursive: true, force: true }); });

function newEngine(opts = {}) {
  return new SyncEngine({
    podClient: pod,
    localRoot,
    podRoot: POD_ROOT,
    pollIntervalMs: 1_000_000,
    debounceMs: 50,
    ...opts,
  });
}

async function listLocal(rel = '') {
  const dir = rel ? join(localRoot, rel) : localRoot;
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  return dirents.map((e) => e.name).sort();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncEngine — construction', () => {
  it('rejects missing podClient/localRoot/podRoot', () => {
    expect(() => new SyncEngine({})).toThrow();
    expect(() => new SyncEngine({ podClient: pod, localRoot })).toThrow();
    expect(() => new SyncEngine({ podClient: pod, podRoot: POD_ROOT })).toThrow();
  });
  it('exposes pathMap, localRoot, podRoot', () => {
    const e = newEngine();
    expect(e.localRoot).toBe(localRoot);
    expect(e.podRoot).toBe(POD_ROOT);
    expect(e.pathMap).toBeDefined();
  });
});

describe('SyncEngine.runOnce — push (local → pod)', () => {
  it('uploads 5 local files to the pod', async () => {
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(join(localRoot, `f${i}.md`), `content-${i}`);
    }
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(5);
    expect(r.downloads).toBe(0);
    expect(r.conflicts).toBe(0);
    for (let i = 0; i < 5; i++) {
      const stored = pod.store.get(`${POD_ROOT}f${i}.md`);
      expect(stored).toBeDefined();
      expect(stored.contentType).toBe('text/markdown');
    }
  });

  it('uploads nested files preserving relPath', async () => {
    await fs.mkdir(join(localRoot, 'recipes', 'desserts'), { recursive: true });
    await fs.writeFile(join(localRoot, 'recipes', 'desserts', 'cake.md'), 'cake');
    await fs.writeFile(join(localRoot, 'top.md'), 'top');
    const e = newEngine();
    await e.runOnce();
    expect(pod.store.has(`${POD_ROOT}top.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}recipes/desserts/cake.md`)).toBe(true);
  });

  it('ensures the pod root container exists before pushing (Inrupt fix)', async () => {
    // Simulate a pod server that requires explicit container creation
    // before PUT (e.g. Inrupt's storage.inrupt.com).
    const created = [];
    pod.createContainer = async (uri) => {
      const u = uri.endsWith('/') ? uri : `${uri}/`;
      created.push(u);
      return { uri: u };
    };
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    const e = newEngine();
    await e.runOnce();
    expect(created).toContain(POD_ROOT);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('ensures every nested parent container before pushing nested files', async () => {
    const created = new Set();
    pod.createContainer = async (uri) => {
      const u = uri.endsWith('/') ? uri : `${uri}/`;
      created.add(u);
      return { uri: u };
    };
    await fs.mkdir(join(localRoot, 'recipes', 'desserts'), { recursive: true });
    await fs.writeFile(join(localRoot, 'recipes', 'desserts', 'cake.md'), 'cake');
    const e = newEngine();
    await e.runOnce();
    expect(created.has(POD_ROOT)).toBe(true);
    expect(created.has(`${POD_ROOT}recipes/`)).toBe(true);
    expect(created.has(`${POD_ROOT}recipes/desserts/`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}recipes/desserts/cake.md`)).toBe(true);
  });

  it('skips container-ensure when the pod client lacks createContainer (back-compat)', async () => {
    // Mock pod (no createContainer method) — the pre-fix behaviour must
    // continue to work for tests + the in-memory FsBackedMockPodClient.
    expect(typeof pod.createContainer).toBe('undefined');
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(1);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });
});

describe('SyncEngine.runOnce — pull (pod → local)', () => {
  it('downloads pod files into the local root', async () => {
    pod._seed(`${POD_ROOT}a.md`, 'apple');
    pod._seed(`${POD_ROOT}sub/b.md`, 'banana');
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.downloads).toBe(2);
    expect(r.uploads).toBe(0);
    const a = await fs.readFile(join(localRoot, 'a.md'), 'utf8');
    const b = await fs.readFile(join(localRoot, 'sub', 'b.md'), 'utf8');
    expect(a).toBe('apple');
    expect(b).toBe('banana');
  });
});

describe('SyncEngine.runOnce — round-trip', () => {
  it('round-trips a 6-file fixture both directions over two engines', async () => {
    // Write files split across local and pod.
    await fs.writeFile(join(localRoot, 'one.md'),  '1');
    await fs.writeFile(join(localRoot, 'two.md'),  '2');
    pod._seed(`${POD_ROOT}three.md`, '3');
    pod._seed(`${POD_ROOT}four.md`,  '4');
    pod._seed(`${POD_ROOT}sub/five.md`, '5');
    await fs.writeFile(join(localRoot, 'six.md'), '6');

    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(3);
    expect(r.downloads).toBe(3);
    expect(r.conflicts).toBe(0);

    // Pod now has all 6.
    for (const name of ['one.md', 'two.md', 'three.md', 'four.md', 'six.md']) {
      expect(pod.store.has(`${POD_ROOT}${name}`)).toBe(true);
    }
    expect(pod.store.has(`${POD_ROOT}sub/five.md`)).toBe(true);

    // Local now has all 6.
    const top = await listLocal();
    expect(top).toContain('one.md');
    expect(top).toContain('three.md');
    expect(top).toContain('six.md');
    const sub = await listLocal('sub');
    expect(sub).toContain('five.md');

    // Idempotent re-run: no further uploads or downloads.
    const r2 = await e.runOnce();
    expect(r2.uploads).toBe(0);
    expect(r2.downloads).toBe(0);
  });
});

describe('SyncEngine.runOnce — conflict scenario', () => {
  it('writes git-style markers in place + emits "conflict" event', async () => {
    // Initial common state: both sides have 'orig'.
    const file = join(localRoot, 'note.md');
    await fs.writeFile(file, 'orig');
    pod._seed(`${POD_ROOT}note.md`, 'orig');

    // First sync establishes common state.
    const e = newEngine();
    await e.runOnce();
    // Both sides identical, sync is a no-op for state purposes.

    // Now diverge: local + pod each independently edit.
    await fs.writeFile(file, 'local-edit');
    // Update pod via direct seeding (bumps etag).
    pod._seed(`${POD_ROOT}note.md`, 'remote-edit');

    const events = [];
    e.on('conflict', (c) => events.push(c));

    const r = await e.runOnce();
    expect(r.conflicts).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].relPath).toBe('note.md');

    const after = await fs.readFile(file, 'utf8');
    expect(hasConflictMarkers(after)).toBe(true);
    expect(after).toContain('local-edit');
    expect(after).toContain('remote-edit');
  });
});

describe('SyncEngine.deleteLocal — tombstone', () => {
  it('subsequent runOnce skips a tombstoned URI', async () => {
    pod._seed(`${POD_ROOT}gone.md`, 'should-not-download');

    const e = newEngine();
    await e.deleteLocal('gone.md');

    // Confirm tombstone path: pod-client mock recorded it.
    expect(pod.tombstones.has(`${POD_ROOT}gone.md`)).toBe(true);

    const r = await e.runOnce();
    expect(r.downloads).toBe(0);
    // File is NOT downloaded.
    await expect(fs.access(join(localRoot, 'gone.md'))).rejects.toThrow();
  });
});

describe('SyncEngine — state persistence', () => {
  it('persists known state to .canopy/notes-sync-state.json and resumes', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    pod._seed(`${POD_ROOT}b.md`, 'B');

    const e1 = newEngine();
    await e1.runOnce();
    await e1.stop();

    const stateRaw = await fs.readFile(
      join(localRoot, '.canopy', 'notes-sync-state.json'),
      'utf8',
    );
    const state = JSON.parse(stateRaw);
    expect(state.version).toBe(1);
    expect(state.files['a.md']).toBeDefined();
    expect(state.files['b.md']).toBeDefined();

    // New engine: known-state should mean no re-uploads / re-downloads.
    const e2 = newEngine();
    const r = await e2.runOnce();
    expect(r.uploads).toBe(0);
    expect(r.downloads).toBe(0);
    expect(r.conflicts).toBe(0);
  });
});

describe('SyncEngine — direction filters', () => {
  it("'push' only uploads", async () => {
    await fs.writeFile(join(localRoot, 'l.md'), 'l');
    pod._seed(`${POD_ROOT}r.md`, 'r');
    const e = newEngine();
    const r = await e.runOnce({ direction: 'push' });
    expect(r.uploads).toBe(1);
    expect(r.downloads).toBe(0);
    await expect(fs.access(join(localRoot, 'r.md'))).rejects.toThrow();
  });
  it("'pull' only downloads", async () => {
    await fs.writeFile(join(localRoot, 'l.md'), 'l');
    pod._seed(`${POD_ROOT}r.md`, 'r');
    const e = newEngine();
    const r = await e.runOnce({ direction: 'pull' });
    expect(r.uploads).toBe(0);
    expect(r.downloads).toBe(1);
    expect(pod.store.has(`${POD_ROOT}l.md`)).toBe(false);
  });
});

// ── Folio.B4 — versioning integration ──────────────────────────────────────

describe('SyncEngine.versions — capture sites', () => {
  it('captures a snapshot after a successful push', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('a.md');
    expect(list).toHaveLength(1);
    expect(list[0].size).toBe(5);
  });

  it('captures a snapshot after a successful pull', async () => {
    pod._seed(`${POD_ROOT}b.md`, 'banana');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('b.md');
    expect(list).toHaveLength(1);
  });

  it('emits version.new on each successful capture', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    const events = [];
    e.on('version.new', (v) => events.push(v));
    await e.runOnce();
    expect(events.length).toBe(1);
    expect(events[0].relPath).toBe('a.md');
    expect(typeof events[0].ts).toBe('number');
  });

  it('captures the conflicted intermediate state on conflict', async () => {
    const file = join(localRoot, 'note.md');
    await fs.writeFile(file, 'orig');
    pod._seed(`${POD_ROOT}note.md`, 'orig');
    const e = newEngine();
    await e.runOnce(); // common state established (no upload, both sides identical)
    await fs.writeFile(file, 'local-edit');
    pod._seed(`${POD_ROOT}note.md`, 'remote-edit');
    await e.runOnce();
    const list = await e.versions('note.md');
    // The conflict path captured the intermediate marker-laden state.
    expect(list.length).toBeGreaterThanOrEqual(1);
    // Newest version should contain conflict markers.
    const newest = await fs.readFile(list[0].path, 'utf8');
    expect(newest).toMatch(/<{7}\sYOURS/);
  });

  it('skips snapshotting files under dotted paths (no versions of versions)', async () => {
    await fs.mkdir(join(localRoot, '.folio'), { recursive: true });
    await fs.writeFile(join(localRoot, '.folio', 'foo.md'), 'should-not-be-versioned');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('.folio/foo.md');
    expect(list).toEqual([]);
  });
});

describe('SyncEngine.restoreVersion', () => {
  it('writes the snapshot back to the live file and emits version.new for the pre-restore snapshot', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'v1');
    const e = newEngine();
    await e.runOnce();                                   // captures v1

    // Read back what was captured so we can target it for restore.
    const list1 = await e.versions('a.md');
    expect(list1.length).toBe(1);
    const v1Ts = list1[0].ts;

    // Mutate live to a different state, then restore.
    await fs.writeFile(join(localRoot, 'a.md'), 'live-now');
    const r = await e.restoreVersion('a.md', v1Ts);
    expect(r.restoredFromMs).toBe(v1Ts);
    expect(typeof r.snapshotMsBeforeRestore).toBe('number');
    expect(await fs.readFile(join(localRoot, 'a.md'), 'utf8')).toBe('v1');

    // The pre-restore snapshot of 'live-now' is now in history.
    const list2 = await e.versions('a.md');
    const preSnap = list2.find((v) => v.ts === r.snapshotMsBeforeRestore);
    expect(preSnap).toBeDefined();
  });
});

describe('SyncEngine.dropVersions — wired into deleteLocal', () => {
  it('deleteLocal removes version history for the tombstoned file', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    await e.runOnce();
    expect((await e.versions('a.md')).length).toBeGreaterThan(0);
    await e.deleteLocal('a.md');
    expect(await e.versions('a.md')).toEqual([]);
  });
});

describe('SyncEngine — versions retention', () => {
  it('options.versions threads through to captureVersion', async () => {
    const e = new SyncEngine({
      podClient: pod,
      localRoot,
      podRoot: POD_ROOT,
      pollIntervalMs: 1_000_000,
      debounceMs: 50,
      versions: { perFile: 3, budgetMb: 100 },
    });
    expect(e.options.versions.perFile).toBe(3);
    // Capture 5 unique versions; only 3 should remain.
    for (let i = 0; i < 5; i++) {
      await e.captureVersion('a.md', `v${i}-${i}`);
    }
    const list = await e.versions('a.md');
    expect(list.length).toBeLessThanOrEqual(3);
  });
});

// ── Folio v2.1 — setPodClient (hot-swap) ──────────────────────────────────

describe('SyncEngine.setPodClient — hot-swap', () => {
  it('replaces the internal podClient — next runOnce uses the new one', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    await e.runOnce(); // pushes via the original `pod`.
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect(pod.writeCalls).toBeGreaterThan(0);

    // Build a fresh, empty MockPodClient.  After the swap, the new client
    // sees a.md as "missing on pod" (no known state from new pod's view) so
    // the next runOnce uploads to the NEW client, not the old one.
    const pod2 = new MockPodClient(POD_ROOT);
    const before2 = pod2.writeCalls;
    e.setPodClient(pod2);

    await e.runOnce();
    // The swap reset stateLoaded; with an empty `pod2` and the local file
    // present, the diff should classify a.md as "upload to pod2".
    expect(pod2.writeCalls).toBeGreaterThan(before2);
    expect(pod2.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('throws when newClient is missing', () => {
    const e = newEngine();
    expect(() => e.setPodClient(null)).toThrow();
    expect(() => e.setPodClient(undefined)).toThrow();
  });

  it('emits a "pod-client-swapped" event for internal subscribers', () => {
    const e = newEngine();
    const events = [];
    e.on('pod-client-swapped', (p) => events.push(p));
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);
    expect(events).toHaveLength(1);
    expect(typeof events[0].ts).toBe('number');
  });

  it('rapid swaps: only the last one is observable on the next runOnce', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    await e.runOnce();

    const podA = new MockPodClient(POD_ROOT);
    const podB = new MockPodClient(POD_ROOT);
    const podC = new MockPodClient(POD_ROOT);
    e.setPodClient(podA);
    e.setPodClient(podB);
    e.setPodClient(podC);

    await e.runOnce();
    // Only podC should see writes.
    expect(podA.writeCalls).toBe(0);
    expect(podB.writeCalls).toBe(0);
    expect(podC.writeCalls).toBeGreaterThan(0);
    expect(podC.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('swap during in-flight runOnce: the in-flight run uses the OLD client', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await fs.writeFile(join(localRoot, 'b.md'), 'banana');
    const e = newEngine();

    // Gate `pod.list` so we can deterministically synchronise: the run will
    // pause at scanPod's first list() call until we release.  At that point
    // the runOnce body has already snapshotted `#podClient` (which happens
    // BEFORE scanPod) — so swapping `#podClient` after we observe the gate
    // hit cannot affect the in-flight run.
    let releaseList;
    const listGate = new Promise((resolve) => { releaseList = resolve; });
    let listEntered = null;
    const enteredP = new Promise((resolve) => { listEntered = resolve; });
    const origList = pod.list.bind(pod);
    pod.list = async (...args) => {
      listEntered();
      await listGate;
      return origList(...args);
    };

    // Kick off a runOnce against the original `pod`; do NOT await.
    const inflight = e.runOnce();

    // Wait for pod.list to actually be entered — at this point, the
    // runOnce body has executed past the `const podClient = this.#podClient`
    // line.  Now any swap is "after the snapshot".
    await enteredP;

    // Swap — the in-flight run has already snapshotted `pod`.
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);

    // Release the list gate so the in-flight run can finish.
    releaseList();

    // The in-flight run finishes against `pod` (per the contract).
    const r = await inflight;
    expect(r.uploads).toBe(2);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}b.md`)).toBe(true);
    // pod2 should have no writes from the in-flight run.
    expect(pod2.writeCalls).toBe(0);

    // Next runOnce uses pod2.
    await e.runOnce();
    expect(pod2.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('swap-with-pending-watch-event: scheduled run uses the new client', async () => {
    const e = newEngine();
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);
    await fs.writeFile(join(localRoot, 'pend.md'), 'pending');
    // Manual runOnce stands in for a debounced watch event landing post-swap.
    await e.runOnce();
    expect(pod2.store.has(`${POD_ROOT}pend.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}pend.md`)).toBe(false);
  });
});

describe('SyncEngine — start/stop lifecycle', () => {
  it('start sets up watcher + interval; stop tears them down without leaks', async () => {
    const e = newEngine();
    e.start();
    // Give chokidar a tick to attach.
    await new Promise((r) => setTimeout(r, 60));
    await e.stop();
    // After stop, no scheduled runs should fire even if we wait.
    let calls = 0;
    e.on('synced', () => calls++);
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(0);
  });

  it('start triggers an initial runOnce', async () => {
    await fs.writeFile(join(localRoot, 'init.md'), 'initial');
    const e = newEngine();
    const synced = new Promise((resolve) => e.on('synced', resolve));
    e.start();
    await synced;
    await e.stop();
    expect(pod.store.has(`${POD_ROOT}init.md`)).toBe(true);
  });
});

// ── Folio v2.6 — sha-stable watcher hardening ──────────────────────────────

describe('SyncEngine — watcher sha-stability (Folio v2.6)', () => {
  // Helper: quietly count `synced` events fired by an engine.
  function countSynced(engine) {
    const state = { count: 0 };
    engine.on('synced', () => { state.count++; });
    return state;
  }

  // Helper: poll until `predicate()` returns true, capped at `timeoutMs` of
  // wall clock.  Uses real-time setTimeout (so no fake-timer interference).
  async function waitFor(predicate, timeoutMs = 1500, intervalMs = 10) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  it('exposes options.watcher with defaults + threads custom values through', () => {
    const def = newEngine();
    expect(def.options.watcher).toEqual({ stableMs: 250, maxStableWaitMs: 5000 });
    const custom = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 200 } });
    expect(custom.options.watcher).toEqual({ stableMs: 30, maxStableWaitMs: 200 });
  });

  it('waits for sha to stabilise before firing runOnce (stable case)', async () => {
    // Tight stability window so the test is bounded.  debounceMs is the
    // existing 50ms test default; stableMs 30ms; max wait 500ms.
    const e = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 500 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'stable.md');
    await fs.writeFile(file, 'first');
    e._injectWatchEventForTest(file, 'add');

    // Wait for the debounce + stability windows to elapse.  No further
    // writes — the file's sha is stable.
    const decided = await waitFor(() => decisions.some((d) => d.decision === 'stable'));
    expect(decided).toBe(true);

    // runOnce fires after the stable decision.  We tolerate a brief gap
    // for the runOnce promise to resolve.
    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);
    expect(syncedCount.count).toBe(1);

    e._disarmForTest();
  });

  it('does NOT fire runOnce for a file deleted before the vigil settles', async () => {
    const e = newEngine({ watcher: { stableMs: 60, maxStableWaitMs: 500 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'doomed.md');
    await fs.writeFile(file, 'gonna-go');
    e._injectWatchEventForTest(file, 'add');

    // Delete BEFORE the first stability re-check fires.  We need to wait
    // out the debounce (~50ms) but delete inside the stableMs window.
    await new Promise((r) => setTimeout(r, 55)); // past debounce, into vigil
    await fs.rm(file, { force: true });

    // Wait long enough for the re-check to land + decide "deleted".
    const decided = await waitFor(() => decisions.some((d) => d.decision === 'deleted'));
    expect(decided).toBe(true);

    // No runOnce should have fired.
    expect(syncedCount.count).toBe(0);

    e._disarmForTest();
  });

  it('caps total wait at maxStableWaitMs for an ever-changing file + emits warning', async () => {
    // Tight cap so the test runs fast (real wall clock).
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 200 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const warnings = [];
    e.on('warning', (w) => warnings.push(w));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'churn.md');
    await fs.writeFile(file, 'v0');
    e._injectWatchEventForTest(file, 'add');

    // Mutate the file every ~10ms until the cap fires.  Bounded by 400ms
    // of wall clock to keep the test under the 2s budget.
    const churnDeadline = Date.now() + 400;
    let i = 0;
    while (Date.now() < churnDeadline) {
      i++;
      try { await fs.writeFile(file, `v${i}-${Date.now()}-${Math.random()}`); }
      catch { /* race with internal read; ignore */ }
      if (decisions.some((d) => d.decision === 'capped')) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // The cap MUST have fired, with a warning + a runOnce dispatched.
    const capped = await waitFor(() => decisions.some((d) => d.decision === 'capped'));
    expect(capped).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].phase).toBe('unstable-write');
    expect(warnings[0].absPath).toBe(file);
    expect(typeof warnings[0].elapsedMs).toBe('number');

    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);

    e._disarmForTest();
  });

  it('handles two files saved at once with independent stability vigils', async () => {
    const e = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 500 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const f1 = join(localRoot, 'a.md');
    const f2 = join(localRoot, 'b.md');
    await fs.writeFile(f1, 'A');
    await fs.writeFile(f2, 'B');
    e._injectWatchEventForTest(f1, 'add');
    e._injectWatchEventForTest(f2, 'add');

    // Both should reach 'stable' independently.
    const allStable = await waitFor(() =>
      decisions.filter((d) => d.decision === 'stable').length >= 2,
    );
    expect(allStable).toBe(true);
    const stablePaths = decisions
      .filter((d) => d.decision === 'stable')
      .map((d) => d.absPath)
      .sort();
    expect(stablePaths).toContain(f1);
    expect(stablePaths).toContain(f2);

    // runOnce should have run at least once and completed both uploads.
    const ran = await waitFor(() => syncedCount.count >= 1 &&
      pod.store.has(`${POD_ROOT}a.md`) && pod.store.has(`${POD_ROOT}b.md`));
    expect(ran).toBe(true);

    e._disarmForTest();
  });

  it('restarts the wait when sha changes between checks (no premature fire)', async () => {
    const e = newEngine({ watcher: { stableMs: 40, maxStableWaitMs: 800 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'flap.md');
    await fs.writeFile(file, 'first');
    e._injectWatchEventForTest(file, 'add');

    // Wait past the debounce window so the vigil is armed, then change
    // content once before the first stable check fires.
    await new Promise((r) => setTimeout(r, 55)); // past 50ms debounce
    await fs.writeFile(file, 'second'); // mutate during vigil
    // Now leave it alone — the vigil should detect the change, restart,
    // then settle on the second sha.

    // Eventually we expect at least one 'changed' decision followed by
    // a 'stable' decision, and exactly one runOnce.
    const sawChange = await waitFor(() => decisions.some((d) => d.decision === 'changed'));
    expect(sawChange).toBe(true);

    const settled = await waitFor(() => decisions.some((d) => d.decision === 'stable'));
    expect(settled).toBe(true);

    // No premature firing — runOnce only counts after the stable decision.
    expect(syncedCount.count).toBe(1);

    e._disarmForTest();
  });

  it('stop() cancels pending stability vigils — no spurious runOnce', async () => {
    const e = newEngine({ watcher: { stableMs: 50, maxStableWaitMs: 500 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'mid.md');
    await fs.writeFile(file, 'mid-state');
    e._injectWatchEventForTest(file, 'add');

    // Tear down before the vigil could possibly settle.
    await new Promise((r) => setTimeout(r, 10));
    e._disarmForTest();

    // Wait past where 'stable' would have landed had we not torn down.
    await new Promise((r) => setTimeout(r, 200));

    // No 'stable' or 'capped' decisions; no runOnce.
    const fired = decisions.filter((d) => d.decision === 'stable' || d.decision === 'capped');
    expect(fired).toEqual([]);
    expect(syncedCount.count).toBe(0);
  });
});

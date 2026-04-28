import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveSyncSkill } from '../../src/protocol/LiveSyncSkill.js';
import { VaultMemory }   from '../../src/identity/VaultMemory.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock source adapter that returns each batch in `batches` on
 * successive `listChanges` calls.  Each batch is { events, nextCursor }.
 * When no more batches remain, returns an empty batch with the last cursor.
 */
function makeSource(batches) {
  let i = 0;
  const lastCursor = batches.length > 0 ? batches[batches.length - 1].nextCursor : null;
  const listChanges = vi.fn(async ({ cursor } = {}) => {
    if (i < batches.length) {
      const b = batches[i++];
      return { events: b.events, nextCursor: b.nextCursor };
    }
    return { events: [], nextCursor: lastCursor };
  });
  const fetchPayload = vi.fn(async (id) => ({ fetched: id }));
  return { listChanges, fetchPayload };
}

/**
 * Build a mock target adapter backed by an in-memory map.
 */
function makeTarget({ preloaded = {} } = {}) {
  const store = new Map(Object.entries(preloaded));
  return {
    _store: store,
    write: vi.fn(async (uri, content, opts = {}) => {
      store.set(uri, { content, etag: `etag-${Date.now()}-${Math.random()}`, lastModified: Date.now(), opts });
      return { uri };
    }),
    read: vi.fn(async (uri) => store.get(uri) ?? null),
    exists: vi.fn(async (uri) => store.has(uri)),
    delete: vi.fn(async (uri) => { store.delete(uri); }),
  };
}

function ev(overrides = {}) {
  return {
    id:          overrides.id          ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    sourceUri:   overrides.sourceUri   ?? 'src://item',
    targetUri:   overrides.targetUri   ?? 'tgt://item',
    contentType: overrides.contentType ?? 'application/json',
    payload:     overrides.payload     ?? { hello: 'world' },
    mtime:       overrides.mtime       ?? Date.now(),
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('LiveSyncSkill — construction', () => {
  it('throws on missing required options', () => {
    const vault = new VaultMemory();
    const source = makeSource([]);
    const target = makeTarget();
    expect(() => new LiveSyncSkill({ source, target, vault })).toThrow(/name/);
    expect(() => new LiveSyncSkill({ name: 'x', target, vault })).toThrow(/source/);
    expect(() => new LiveSyncSkill({ name: 'x', source, vault })).toThrow(/target/);
    expect(() => new LiveSyncSkill({ name: 'x', source, target })).toThrow(/vault/);
  });

  it('exposes name, isRunning, stats, lastError', () => {
    const sync = new LiveSyncSkill({
      name: 'x', source: makeSource([]), target: makeTarget(), vault: new VaultMemory(),
    });
    expect(sync.name).toBe('x');
    expect(sync.isRunning).toBe(false);
    expect(sync.stats).toEqual({ eventsApplied: 0, eventsSkipped: 0, conflicts: 0, lastSyncedAt: null });
    expect(sync.lastError).toBe(null);
  });
});

describe('LiveSyncSkill — happy path', () => {
  it('applies all events from the source to the target', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a', payload: { v: 1 } }),
      ev({ id: 'b', targetUri: 'tgt://b', payload: { v: 2 } }),
      ev({ id: 'c', targetUri: 'tgt://c', payload: { v: 3 } }),
    ];
    const source = makeSource([{ events, nextCursor: 'cur-1' }]);
    const target = makeTarget();
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'happy', source, target, vault });
    const result = await sync.runOnce();

    expect(result).toEqual({ applied: 3, skipped: 0, conflicts: 0 });
    expect(target.write).toHaveBeenCalledTimes(3);
    expect(target._store.size).toBe(3);
    expect(target._store.get('tgt://a').content).toEqual({ v: 1 });

    // Cursor advanced and saved.
    const raw = await vault.get('livesync:happy');
    const state = JSON.parse(raw);
    expect(state.cursor).toBe('cur-1');
    expect(state.appliedIds).toEqual(['a', 'b', 'c']);
  });

  it('fetches payload via fetchPayload when event omits payload', async () => {
    const events = [ev({ id: 'a', payload: undefined })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget();
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'fetch', source, target, vault });
    await sync.runOnce();

    expect(source.fetchPayload).toHaveBeenCalledWith('a');
    expect(target._store.get('tgt://item').content).toEqual({ fetched: 'a' });
  });
});

describe('LiveSyncSkill — idempotency', () => {
  it('skips already-applied events on a second run', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a' }),
      ev({ id: 'b', targetUri: 'tgt://b' }),
    ];
    // Each call returns the same events (simulates source not yet advanced).
    const source = makeSource([
      { events, nextCursor: 'c1' },
      { events, nextCursor: 'c1' },
    ]);
    const target = makeTarget();
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'idem', source, target, vault });

    const r1 = await sync.runOnce();
    expect(r1).toEqual({ applied: 2, skipped: 0, conflicts: 0 });

    const r2 = await sync.runOnce();
    expect(r2).toEqual({ applied: 0, skipped: 2, conflicts: 0 });

    // target.write only fired during the first run.
    expect(target.write).toHaveBeenCalledTimes(2);
  });
});

describe('LiveSyncSkill — tombstones', () => {
  it('calls target.delete for events with deleted: true', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a', deleted: true, payload: undefined }),
    ];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: 'x' } } });
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'tomb', source, target, vault });
    const r = await sync.runOnce();

    expect(r.applied).toBe(1);
    expect(target.delete).toHaveBeenCalledWith('tgt://a');
    expect(target._store.has('tgt://a')).toBe(false);
    expect(target.write).not.toHaveBeenCalled();
  });

  it('no-op when deleted event but target has no delete method', async () => {
    const events = [ev({ id: 'a', deleted: true, payload: undefined })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget();
    delete target.delete;
    const vault = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'tomb-none', source, target, vault });
    const r = await sync.runOnce();
    expect(r.applied).toBe(1);
    expect(target.write).not.toHaveBeenCalled();
  });
});

describe('LiveSyncSkill — conflict resolution', () => {
  it('onConflict returns "remote" → target NOT overwritten', async () => {
    const events = [ev({ id: 'a', targetUri: 'tgt://a', payload: { from: 'source' } })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: { from: 'remote' }, etag: 'r1', lastModified: 100 } } });
    const vault  = new VaultMemory();

    const onConflict = vi.fn(async () => 'remote');
    const sync = new LiveSyncSkill({ name: 'cf-r', source, target, vault, onConflict });
    const r = await sync.runOnce();

    expect(r.applied).toBe(1);              // applied = "decision was made"
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(target.write).not.toHaveBeenCalled();
    expect(target._store.get('tgt://a').content).toEqual({ from: 'remote' });
  });

  it('onConflict returns "local" → target overwritten with source payload', async () => {
    const events = [ev({ id: 'a', targetUri: 'tgt://a', payload: { from: 'source' } })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: { from: 'remote' } } } });
    const vault  = new VaultMemory();

    const onConflict = vi.fn(async () => 'local');
    const sync = new LiveSyncSkill({ name: 'cf-l', source, target, vault, onConflict });
    await sync.runOnce();

    expect(target.write).toHaveBeenCalledWith('tgt://a', { from: 'source' }, expect.objectContaining({ force: true }));
    expect(target._store.get('tgt://a').content).toEqual({ from: 'source' });
  });

  it('onConflict returns { content } → target overwritten with merged content', async () => {
    const events = [ev({ id: 'a', targetUri: 'tgt://a', payload: { a: 1 } })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: { b: 2 } } } });
    const vault  = new VaultMemory();

    const merged = { a: 1, b: 2 };
    const onConflict = vi.fn(async () => ({ content: merged, contentType: 'application/json' }));
    const sync = new LiveSyncSkill({ name: 'cf-m', source, target, vault, onConflict });
    await sync.runOnce();

    expect(target.write).toHaveBeenCalledWith('tgt://a', merged, expect.objectContaining({ force: true, contentType: 'application/json' }));
    expect(target._store.get('tgt://a').content).toBe(merged);
  });

  it('no onConflict + existing target → throws LIVESYNC_CONFLICT_UNRESOLVED, loop continues', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a', payload: { v: 1 } }),  // conflicts
      ev({ id: 'b', targetUri: 'tgt://b', payload: { v: 2 } }),  // applies
    ];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: 'existing' } } });
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'cf-unres', source, target, vault });
    const r = await sync.runOnce();

    expect(r.conflicts).toBe(1);
    expect(r.applied).toBe(1);
    expect(target._store.get('tgt://a').content).toBe('existing');     // unchanged
    expect(target._store.get('tgt://b').content).toEqual({ v: 2 });    // applied
    expect(sync.lastError).toBeTruthy();
    expect(sync.lastError.code).toBe('LIVESYNC_CONFLICT_UNRESOLVED');
  });

  it('onConflict throws → wrapped as LIVESYNC_CONFLICT_HANDLER_THREW; loop continues', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a' }),
      ev({ id: 'b', targetUri: 'tgt://b' }),
    ];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: 'x' } } });
    const vault  = new VaultMemory();

    const onConflict = vi.fn(async () => { throw new Error('boom'); });
    const sync = new LiveSyncSkill({ name: 'cf-throw', source, target, vault, onConflict });
    const r = await sync.runOnce();

    expect(r.applied).toBe(1);
    expect(sync.lastError.code).toBe('LIVESYNC_CONFLICT_HANDLER_THREW');
    expect(target._store.get('tgt://b')).toBeTruthy();
  });

  it('onConflict returns garbage → throws LIVESYNC_CONFLICT_BAD_RESOLUTION', async () => {
    const events = [ev({ id: 'a', targetUri: 'tgt://a' })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget({ preloaded: { 'tgt://a': { content: 'x' } } });
    const vault  = new VaultMemory();

    const onConflict = vi.fn(async () => 'wat');
    const sync = new LiveSyncSkill({ name: 'cf-bad', source, target, vault, onConflict });
    await sync.runOnce();

    expect(sync.lastError.code).toBe('LIVESYNC_CONFLICT_BAD_RESOLUTION');
  });
});

describe('LiveSyncSkill — start/stop polling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('start kicks an immediate cycle and reschedules on interval; stop halts it', async () => {
    const batches = [
      { events: [ev({ id: 'a' })], nextCursor: 'c1' },
      { events: [ev({ id: 'b', targetUri: 'tgt://b' })], nextCursor: 'c2' },
      { events: [], nextCursor: 'c2' },
    ];
    const source = makeSource(batches);
    const target = makeTarget();
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'poll', source, target, vault, pollIntervalMs: 1000 });
    sync.start();
    expect(sync.isRunning).toBe(true);

    // Drain microtasks for the immediate tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(source.listChanges).toHaveBeenCalledTimes(1);

    // Advance one interval — second tick fires.
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.listChanges).toHaveBeenCalledTimes(2);

    sync.stop();
    expect(sync.isRunning).toBe(false);

    // Advance more — no further calls.
    await vi.advanceTimersByTimeAsync(5000);
    expect(source.listChanges).toHaveBeenCalledTimes(2);
  });

  it('start is idempotent', () => {
    const sync = new LiveSyncSkill({
      name: 'x', source: makeSource([]), target: makeTarget(), vault: new VaultMemory(),
    });
    sync.start();
    sync.start();
    expect(sync.isRunning).toBe(true);
    sync.stop();
  });
});

describe('LiveSyncSkill — state persistence across instances', () => {
  it('a second instance with the same name + vault sees prior cursor and skips already-applied events', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a' }),
      ev({ id: 'b', targetUri: 'tgt://b' }),
    ];
    const sourceA = makeSource([{ events, nextCursor: 'cur-A' }]);
    const targetA = makeTarget();
    const vault   = new VaultMemory();

    const a = new LiveSyncSkill({ name: 'shared', source: sourceA, target: targetA, vault });
    const r1 = await a.runOnce();
    expect(r1.applied).toBe(2);

    // New instance — same vault, same name.
    const sourceB = makeSource([{ events, nextCursor: 'cur-B' }]);
    const targetB = makeTarget();
    const b = new LiveSyncSkill({ name: 'shared', source: sourceB, target: targetB, vault });

    // listChanges is called with the cursor saved by A.
    const r2 = await b.runOnce();
    expect(sourceB.listChanges).toHaveBeenCalledWith({ cursor: 'cur-A' });
    expect(r2.skipped).toBe(2);
    expect(r2.applied).toBe(0);
    expect(targetB.write).not.toHaveBeenCalled();
  });
});

describe('LiveSyncSkill — onChange observability', () => {
  it('fires per applied event, not for skipped/conflicted events', async () => {
    const events = [
      ev({ id: 'a', targetUri: 'tgt://a' }),
      ev({ id: 'b', targetUri: 'tgt://b' }),
      ev({ id: 'c', targetUri: 'tgt://c' }),
    ];
    const source = makeSource([
      { events, nextCursor: 'c1' },
      { events, nextCursor: 'c1' },
    ]);
    // tgt://b is preloaded → conflict; no onConflict → throws → not applied.
    const target = makeTarget({ preloaded: { 'tgt://b': { content: 'pre' } } });
    const vault  = new VaultMemory();

    const onChange = vi.fn(async () => {});
    const sync = new LiveSyncSkill({ name: 'obs', source, target, vault, onChange });

    const r1 = await sync.runOnce();
    expect(r1.applied).toBe(2);
    expect(r1.conflicts).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[0][0]).toMatchObject({ id: 'a', applied: true });
    expect(onChange.mock.calls[1][0]).toMatchObject({ id: 'c', applied: true });

    // Second run: a + c are now in appliedIds → skipped; b still conflicts → not fired.
    const r2 = await sync.runOnce();
    expect(r2.skipped).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(2);  // unchanged
  });

  it('onChange that throws does not break sync', async () => {
    const events = [ev({ id: 'a', targetUri: 'tgt://a' })];
    const source = makeSource([{ events, nextCursor: 'c1' }]);
    const target = makeTarget();
    const vault  = new VaultMemory();

    const onChange = vi.fn(async () => { throw new Error('observer-boom'); });
    const sync = new LiveSyncSkill({ name: 'obs-throw', source, target, vault, onChange });
    const r = await sync.runOnce();

    expect(r.applied).toBe(1);
    expect(target._store.get('tgt://a')).toBeTruthy();
  });
});

describe('LiveSyncSkill — runOnce coalescing', () => {
  it('overlapping runOnce calls share the same in-flight cycle', async () => {
    let resolveList;
    const listChanges = vi.fn(() => new Promise(r => { resolveList = r; }));
    const source = { listChanges, fetchPayload: vi.fn() };
    const target = makeTarget();
    const vault  = new VaultMemory();

    const sync = new LiveSyncSkill({ name: 'coal', source, target, vault });

    const p1 = sync.runOnce();
    const p2 = sync.runOnce();
    // Drain microtasks so the inner #runOnceInner reaches listChanges.
    await Promise.resolve();
    await Promise.resolve();
    expect(listChanges).toHaveBeenCalledTimes(1);

    resolveList({ events: [], nextCursor: 'c' });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });
});

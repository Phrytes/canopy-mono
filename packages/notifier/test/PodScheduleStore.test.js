/**
 * PodScheduleStore tests — uses a mock PodClient that records reads
 * + writes against an in-memory map.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { PodScheduleStore } from '../src/stores/PodScheduleStore.js';

const URI = 'https://alice.example/notifier/jobs.json';

function makeMockPodClient(initial = null) {
  const store = new Map();
  if (initial != null) store.set(URI, initial);
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    async read(uri, opts = {}) {
      reads.push({ uri, opts });
      if (!store.has(uri)) {
        const err = new Error(`NOT_FOUND ${uri}`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      return { content: store.get(uri) };
    },
    async write(uri, content, opts = {}) {
      writes.push({ uri, content, opts });
      store.set(uri, String(content));
    },
    _store: store,
  };
}

function jobOf(jobId, extra = {}) {
  return {
    jobId,
    kind:        'once',
    channelId:   'chat',
    recipient:   '@alice',
    triggerAt:   1_700_000_000_000,
    builder:     async () => ({ text: 'hello' }),
    metadata:    { kind: 'daily-digest' },
    ...extra,
  };
}

describe('PodScheduleStore — construction', () => {
  it('throws without podClient', () => {
    expect(() => new PodScheduleStore({ uri: URI })).toThrow(/podClient/);
  });
  it('throws without uri', () => {
    expect(() => new PodScheduleStore({ podClient: makeMockPodClient() })).toThrow(/uri/);
  });
  it('throws when podClient lacks read/write', () => {
    expect(() => new PodScheduleStore({ podClient: {}, uri: URI })).toThrow(/podClient/);
  });
});

describe('PodScheduleStore — first-use (no prior data)', () => {
  let pc, store;
  beforeEach(() => {
    pc = makeMockPodClient();                  // no prior content
    store = new PodScheduleStore({ podClient: pc, uri: URI });
  });

  it('listAll() on a fresh store returns []', async () => {
    expect(await store.listAll()).toEqual([]);
  });

  it('put() persists a serialised blob', async () => {
    await store.put(jobOf('j1'));
    expect(pc.writes).toHaveLength(1);
    const persisted = JSON.parse(pc.writes[0].content);
    expect(persisted.version).toBe(1);
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0].jobId).toBe('j1');
    // builder is NOT serialised
    expect(persisted.jobs[0]).not.toHaveProperty('builder');
    // contentType is set so the pod stores it as JSON
    expect(pc.writes[0].opts.contentType).toBe('application/json');
  });

  it('get() returns the just-put job', async () => {
    await store.put(jobOf('j1'));
    const r = await store.get('j1');
    expect(r?.jobId).toBe('j1');
    expect(typeof r?.builder).toBe('function');
  });

  it('remove() persists the deletion', async () => {
    await store.put(jobOf('j1'));
    await store.remove('j1');
    const persisted = JSON.parse(pc.writes.at(-1).content);
    expect(persisted.jobs).toEqual([]);
  });

  it('removeByCancelKey() drops only matching jobs', async () => {
    await store.put(jobOf('j1', { cancelKey: 'k1' }));
    await store.put(jobOf('j2', { cancelKey: 'k2' }));
    await store.put(jobOf('j3', { cancelKey: 'k1' }));
    await store.removeByCancelKey('k1');
    const remaining = await store.listAll();
    expect(remaining.map((j) => j.jobId)).toEqual(['j2']);
  });

  it('removeByCancelKey() with no matches does not flush', async () => {
    await store.put(jobOf('j1'));
    const writeCount = pc.writes.length;
    await store.removeByCancelKey('nonexistent');
    expect(pc.writes.length).toBe(writeCount);            // no extra write
  });

  it('remove() of unknown jobId does not flush', async () => {
    await store.put(jobOf('j1'));
    const writeCount = pc.writes.length;
    await store.remove('does-not-exist');
    expect(pc.writes.length).toBe(writeCount);
  });
});

describe('PodScheduleStore — restore (prior data on pod)', () => {
  it('loads persisted jobs', async () => {
    const initial = JSON.stringify({
      version: 1,
      jobs: [
        { jobId: 'j1', kind: 'once', channelId: 'chat', recipient: '@a', triggerAt: 1, metadata: { kind: 'digest' } },
        { jobId: 'j2', kind: 'recurring', channelId: 'chat', recipient: '@b', cadence: { kind: 'daily', timeLocal: '20:00', tz: 'Europe/Amsterdam' } },
      ],
    });
    const pc = makeMockPodClient(initial);
    const store = new PodScheduleStore({ podClient: pc, uri: URI });
    const all = await store.listAll();
    expect(all.map((j) => j.jobId).sort()).toEqual(['j1', 'j2']);
    // Load happened exactly once
    expect(pc.reads).toHaveLength(1);
  });

  it('builderResolver reconstructs the closure', async () => {
    const initial = JSON.stringify({
      version: 1,
      jobs: [
        { jobId: 'j1', kind: 'once', channelId: 'chat', recipient: '@a', triggerAt: 1, metadata: { msg: 'restored hello' } },
      ],
    });
    const pc = makeMockPodClient(initial);
    const store = new PodScheduleStore({
      podClient: pc,
      uri: URI,
      builderResolver: (persisted) => async () => ({ text: persisted.metadata.msg }),
    });
    const job = await store.get('j1');
    expect(job).not.toBeNull();
    const built = await job.builder();
    expect(built.text).toBe('restored hello');
  });

  it('load is lazy: no I/O on construction', () => {
    const pc = makeMockPodClient(JSON.stringify({ version: 1, jobs: [] }));
    new PodScheduleStore({ podClient: pc, uri: URI });
    expect(pc.reads).toHaveLength(0);
  });

  it('load happens once even with concurrent calls', async () => {
    const initial = JSON.stringify({ version: 1, jobs: [] });
    const pc = makeMockPodClient(initial);
    const store = new PodScheduleStore({ podClient: pc, uri: URI });
    await Promise.all([store.listAll(), store.listAll(), store.get('x')]);
    expect(pc.reads).toHaveLength(1);
  });

  it('tolerates a corrupt JSON blob (treats as empty)', async () => {
    const pc = makeMockPodClient('{not valid json');
    const store = new PodScheduleStore({ podClient: pc, uri: URI });
    expect(await store.listAll()).toEqual([]);
  });

  it('skips persisted entries without a jobId', async () => {
    const initial = JSON.stringify({
      version: 1,
      jobs: [{ jobId: 'j1', kind: 'once' }, { kind: 'once' }, null],
    });
    const pc = makeMockPodClient(initial);
    const store = new PodScheduleStore({ podClient: pc, uri: URI });
    const all = await store.listAll();
    expect(all.map((j) => j.jobId)).toEqual(['j1']);
  });
});

describe('PodScheduleStore — round-trip', () => {
  it('write then re-read via a fresh store recovers state', async () => {
    const pc = makeMockPodClient();
    const a = new PodScheduleStore({ podClient: pc, uri: URI });
    await a.put(jobOf('j1', { metadata: { msg: 'persisted' } }));
    await a.put(jobOf('j2', { metadata: { msg: 'two' } }));

    // Fresh store reads from the same pc → loads persisted state.
    const b = new PodScheduleStore({
      podClient: pc,
      uri: URI,
      builderResolver: (p) => async () => ({ text: p.metadata.msg }),
    });
    const all = await b.listAll();
    expect(all.map((j) => j.jobId).sort()).toEqual(['j1', 'j2']);
    const j1 = await b.get('j1');
    const built = await j1.builder();
    expect(built.text).toBe('persisted');
  });
});

/**
 * Objective D (Surface 3a) — the availability pref is device-local but its
 * value must be SHAREABLE between agents.
 *
 * `podAvailabilityIo` mirrors the keyless per-user pref to a pod resource
 * through a `createPodWriter`-shaped writer; `tieredAvailabilityIo` composes
 * local (canonical) + pod (mirror). Both compose through
 * `createAvailabilityStore` so the integration test exercises the real
 * persistence path the shells wire — and proves a save by one agent is read
 * back by a SEPARATE agent through the shared pod.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_AVAILABILITY,
  createAvailabilityStore,
  podAvailabilityIo,
  tieredAvailabilityIo,
} from '../../src/v2/memberAvailability.js';

/** In-memory podWriter (read/write JSON keyed by `${app}::${resource}`). */
function makeMockPodWriter() {
  const store = new Map();
  const key = (app, resource) => `${app}::${resource}`;
  return {
    store,
    read: async (app, resource) => {
      const body = store.get(key(app, resource));
      return body == null
        ? { ok: false, body: null, status: 404 }
        : { ok: true, body, status: 200 };
    },
    write: async (app, resource, body) => {
      store.set(key(app, resource), body);
      return { ok: true, status: 200, url: key(app, resource) };
    },
  };
}

/** In-memory keyless IO that records every write so tests can assert. */
function makeMemIo() {
  let value = null;
  return {
    get value() { return value; },
    load: async () => value,
    save: async (v) => { value = v; },
  };
}

describe('podAvailabilityIo', () => {
  it('is a no-op when getWriter returns null', async () => {
    const io = podAvailabilityIo({ getWriter: () => null });
    expect(await io.load()).toBeNull();
    await io.save({ hello: 'world' });   // does not throw
    expect(await io.load()).toBeNull();
  });

  it('round-trips JSON through the writer at the per-user resource', async () => {
    const writer = makeMockPodWriter();
    const io = podAvailabilityIo({ getWriter: () => writer });
    const pref = { holiday: { active: true, until: '2026-08-01' }, quietHours: { enabled: false } };
    await io.save(pref);
    expect(await io.load()).toEqual(pref);
    // Keyless per-user resource under the availability app segment.
    expect(writer.store.has('cc-availability::availability.json')).toBe(true);
  });

  it('honours a custom app segment', async () => {
    const writer = makeMockPodWriter();
    const io = podAvailabilityIo({ getWriter: () => writer, app: 'cc-avail-alt' });
    await io.save({ ok: 1 });
    expect(writer.store.has('cc-avail-alt::availability.json')).toBe(true);
  });

  it('survives a writer that throws (load → null, save swallowed)', async () => {
    const bad = {
      read:  async () => { throw new Error('boom'); },
      write: async () => { throw new Error('boom'); },
    };
    const io = podAvailabilityIo({ getWriter: () => bad });
    expect(await io.load()).toBeNull();
    await expect(io.save({ a: 1 })).resolves.toBeUndefined();
  });

  it('throws when constructed without a getWriter thunk', () => {
    expect(() => podAvailabilityIo({})).toThrow(/getWriter/);
  });
});

describe('tieredAvailabilityIo', () => {
  it('read returns local when present (pod not consulted)', async () => {
    const local = makeMemIo(); await local.save({ from: 'local' });
    const pod   = makeMemIo(); await pod.save({ from: 'pod' });
    const tiered = tieredAvailabilityIo(local, pod);
    expect(await tiered.load()).toEqual({ from: 'local' });
  });

  it('read falls back to pod when local is empty AND seeds local', async () => {
    const local = makeMemIo();
    const pod   = makeMemIo(); await pod.save({ from: 'pod' });
    const tiered = tieredAvailabilityIo(local, pod);
    expect(await tiered.load()).toEqual({ from: 'pod' });
    expect(local.value).toEqual({ from: 'pod' });   // cached down
  });

  it('write ALWAYS mirrors to pod (the pref is inherently shareable)', async () => {
    const local = makeMemIo();
    const pod   = makeMemIo();
    const tiered = tieredAvailabilityIo(local, pod);
    await tiered.save({ quietHours: { enabled: true } });
    expect(local.value).toEqual({ quietHours: { enabled: true } });
    expect(pod.value).toEqual({ quietHours: { enabled: true } });
  });

  it('read returns null when neither side has it', async () => {
    expect(await tieredAvailabilityIo(makeMemIo(), makeMemIo()).load()).toBeNull();
  });
});

describe('end-to-end through createAvailabilityStore', () => {
  let writer;
  beforeEach(() => { writer = makeMockPodWriter(); });

  it('a save publishes to the shared pod', async () => {
    const local = makeMemIo();
    const store = createAvailabilityStore(
      tieredAvailabilityIo(local, podAvailabilityIo({ getWriter: () => writer })),
    );
    const after = await store.update({ holiday: { active: true, until: '2026-08-09' } });
    expect(after.holiday.active).toBe(true);
    expect(local.value.holiday.active).toBe(true);            // local canonical
    expect(writer.store.has('cc-availability::availability.json')).toBe(true); // published
  });

  it('a SEPARATE reader (another agent) sees the published pref through the pod', async () => {
    // Agent A (the member editing the panel) saves.
    {
      const authorStore = createAvailabilityStore(
        tieredAvailabilityIo(makeMemIo(), podAvailabilityIo({ getWriter: () => writer })),
      );
      await authorStore.update({
        holiday:    { active: true, until: '2026-08-09' },
        quietHours: { enabled: true, from: '23:00', to: '06:00', weekends: true },
      });
    }
    // Agent B (e.g. the planner / another member's agent) — fresh local,
    // SAME pod — reads the published value on first read.
    const readerLocal = makeMemIo();
    const readerStore = createAvailabilityStore(
      tieredAvailabilityIo(readerLocal, podAvailabilityIo({ getWriter: () => writer })),
    );
    const seen = await readerStore.get();
    expect(seen.holiday).toEqual({ active: true, until: '2026-08-09' });
    expect(seen.quietHours.enabled).toBe(true);
    expect(seen.quietHours.weekends).toBe(true);
    expect(readerLocal.value).not.toBeNull();                 // seeded local from pod
  });

  it('with no pod writer wired (getWriter→null), behaviour is local-only + unchanged', async () => {
    const local = makeMemIo();
    const store = createAvailabilityStore(
      tieredAvailabilityIo(local, podAvailabilityIo({ getWriter: () => null })),
    );
    await store.update({ holiday: { active: true } });
    expect(local.value.holiday.active).toBe(true);
    // Nothing mirrored anywhere else; a fresh reader with an empty pod
    // falls back to defaults.
    const fresh = createAvailabilityStore(
      tieredAvailabilityIo(makeMemIo(), podAvailabilityIo({ getWriter: () => null })),
    );
    expect(await fresh.get()).toEqual(DEFAULT_AVAILABILITY);
  });
});

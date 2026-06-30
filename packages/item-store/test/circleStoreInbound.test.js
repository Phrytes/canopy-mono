/**
 * wireCircleStoreInbound (cluster L3 · no-pod-sync INBOUND) — ingest peer envelopes into a CircleItemStore,
 * id-preserving + idempotent, with the echo guard (inbound writes don't re-publish). Pairs with the publish
 * side (setSyncHook/wireStoreMirror) for bidirectional no-pod sync over the per-circle store.
 */
import { describe, it, expect, vi } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { wireStoreMirror } from '../src/mirrorSync.js';
import { wireCircleStoreInbound } from '../src/circleStoreInbound.js';

// A tiny fake notify-envelope substrate: subscribe by kind, emit() fans out to matching subscribers.
function fakeEnvelope() {
  const subs = [];
  return {
    subscribe({ kind, callback }) { const e = { kind, callback }; subs.push(e); return () => { const i = subs.indexOf(e); if (i >= 0) subs.splice(i, 1); }; },
    emit(kind, envelope) { for (const s of subs.slice()) if (s.kind === kind) s.callback(envelope); },
  };
}

const PREFIX = '/household/circles/c1/items/';
const mk = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c1/' });

describe('wireCircleStoreInbound', () => {
  it('ingests an inbound item (id-preserving, create-or-replace)', async () => {
    const store = mk();
    const env = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: env, store, prefix: PREFIX });

    env.emit('household-item', { ref: `${PREFIX}X1`, payload: { id: 'X1', type: 'task', text: 'from peer' } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.get('X1'))?.text).toBe('from peer');     // appeared under the SAME id

    // an update with the same id replaces
    env.emit('household-item', { ref: `${PREFIX}X1`, payload: { id: 'X1', type: 'task', text: 'edited', completedAt: 123 } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.get('X1'))?.completedAt).toBe(123);
  });

  it('ingests a removal', async () => {
    const store = mk();
    const env = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: env, store, prefix: PREFIX });
    env.emit('household-item', { ref: `${PREFIX}X1`, payload: { id: 'X1', type: 'task', text: 'doomed' } });
    await new Promise((r) => setTimeout(r, 0));
    env.emit('household-item-removed', { ref: `${PREFIX}X1`, payload: { originalId: 'X1' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get('X1')).toBeNull();
  });

  it('ECHO GUARD: an inbound ingest does NOT re-publish (sync:false)', async () => {
    const store = mk();
    const env = fakeEnvelope();
    const mirror = { publishItem: vi.fn(), publishItemRemoved: vi.fn() };
    wireStoreMirror(store, mirror);                              // publish-on-write attached…
    wireCircleStoreInbound({ notifyEnvelope: env, store, prefix: PREFIX });   // …and inbound

    env.emit('household-item', { ref: `${PREFIX}X1`, payload: { id: 'X1', type: 'task', text: 'peer' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mirror.publishItem).not.toHaveBeenCalled();          // the ingest did NOT echo back to the mesh

    await store.put({ id: 'L1', type: 'task', text: 'local' }); // a LOCAL write still publishes
    expect(mirror.publishItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'L1' }));
  });

  it('filters by prefix — ignores envelopes for another circle', async () => {
    const store = mk();
    const env = fakeEnvelope();
    wireCircleStoreInbound({ notifyEnvelope: env, store, prefix: PREFIX });
    env.emit('household-item', { ref: '/household/circles/OTHER/items/Z', payload: { id: 'Z', type: 'task', text: 'nope' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get('Z')).toBeNull();                    // out-of-scope → not ingested
  });

  it('the returned unsubscribe stops ingestion', async () => {
    const store = mk();
    const env = fakeEnvelope();
    const off = wireCircleStoreInbound({ notifyEnvelope: env, store, prefix: PREFIX });
    off();
    env.emit('household-item', { ref: `${PREFIX}X1`, payload: { id: 'X1', type: 'task', text: 'after-off' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get('X1')).toBeNull();
  });
});

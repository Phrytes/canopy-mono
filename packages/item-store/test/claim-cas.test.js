/**
 * Slice 1 (PLAN-task-claim-partition) — central-pod one-winner.
 *
 * When the DataSource is pod-backed (honours conditional writes / etag-CAS),
 * `ItemStore.claim` threads `If-Match: <base etag>` so two racing claimers
 * resolve to exactly ONE winner + one `{error:'already-claimed', current}`,
 * even when BOTH read the unassigned task before either wrote (the genuine
 * distributed race). Non-CAS DataSources keep the read-check-write path.
 */
import { describe, it, expect } from 'vitest';
import { ItemStore } from '../src/ItemStore.js';
import { MemorySource } from '@canopy/core';

const ROOT = 'pod://circle/tasks/';

/** A CAS-capable "central pod": per-path etag + If-Match enforcement. */
function makeCasPodSource() {
  const store = new Map();
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    async read(path) { return store.get(path)?.data ?? null; },
    async readEtag(path) { return store.get(path)?.etag ?? null; },
    async write(path, data, opts = {}) {
      const cur = store.get(path);
      if (opts && opts.ifMatch != null && (cur?.etag ?? null) !== opts.ifMatch) {
        throw Object.assign(new Error('If-Match failed'), { code: 'CONFLICT', status: 412 });
      }
      const etag = nextEtag();
      store.set(path, { data, etag });
      return { etag };
    },
    async delete(path) { store.delete(path); },
    async list(prefix = '') { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

describe('Slice 1 — central-pod one-winner (etag-CAS in ItemStore.claim)', () => {
  it('two claimers that BOTH read the unassigned task → exactly one wins', async () => {
    const pod = makeCasPodSource();
    const alice = new ItemStore({ dataSource: pod, rootContainer: ROOT });
    const bob   = new ItemStore({ dataSource: pod, rootContainer: ROOT });

    const [task] = await alice.addItems([{ type: 'task', text: 'shared' }], { actor: 'alice' });
    const path = `${ROOT}items/${task.id}.json`;

    // Snapshot the UNASSIGNED state + etag — this is what a racing peer
    // observed before either write landed.
    const staleData = await pod.read(path);
    const staleEtag = await pod.readEtag(path);

    // Alice claims for real (etag advances; assignee = alice).
    const aliceRes = await alice.claim(task.id, { actor: 'alice' });
    expect(aliceRes.assignee).toBe('alice');

    // Bob races: he still observes the pre-claim snapshot (stale read + stale
    // base etag), so he PASSES the in-memory guard and writes with a stale
    // If-Match → the pod rejects it (CONFLICT) → already-claimed.
    const realRead = pod.read.bind(pod);
    const realReadEtag = pod.readEtag.bind(pod);
    let firstReadServed = false;
    pod.read = async (p) => {
      if (p === path && !firstReadServed) { firstReadServed = true; return staleData; }
      return realRead(p);
    };
    pod.readEtag = async (p) => (p === path ? staleEtag : realReadEtag(p));

    const bobRes = await bob.claim(task.id, { actor: 'bob' });
    expect(bobRes.error).toBe('already-claimed');
    expect(bobRes.current.assignee).toBe('alice');   // re-read surfaces the winner

    // The pod holds exactly one winner.
    pod.read = realRead;
    const finalRaw = await pod.read(path);
    expect(JSON.parse(finalRaw).assignee).toBe('alice');
  });

  it('the winner is whoever the pod accepts first; the loser never overwrites', async () => {
    const pod = makeCasPodSource();
    const s1 = new ItemStore({ dataSource: pod, rootContainer: ROOT });
    const s2 = new ItemStore({ dataSource: pod, rootContainer: ROOT });
    const [task] = await s1.addItems([{ type: 'task', text: 't' }], { actor: 'sys' });
    const r1 = await s1.claim(task.id, { actor: 'u1' });
    expect(r1.assignee).toBe('u1');
    // Synchronous shared view: u2 now reads assignee=u1 → already-claimed.
    const r2 = await s2.claim(task.id, { actor: 'u2' });
    expect(r2.error).toBe('already-claimed');
    expect(r2.current.assignee).toBe('u1');
  });

  it('non-CAS DataSource (MemorySource) — claim path is unchanged', async () => {
    const mem = new MemorySource();
    const store = new ItemStore({ dataSource: mem, rootContainer: ROOT });
    const [task] = await store.addItems([{ type: 'task', text: 'plain' }], { actor: 'sys' });
    const claimed = await store.claim(task.id, { actor: 'alice' });
    expect(claimed.assignee).toBe('alice');
    // A second claim over the same (synchronously shared) source → already-claimed.
    const second = await store.claim(task.id, { actor: 'bob' });
    expect(second.error).toBe('already-claimed');
    expect(second.current.assignee).toBe('alice');
  });
});

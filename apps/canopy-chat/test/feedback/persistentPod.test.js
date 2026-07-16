/**
 * makePersistentOwnPod — the participant OWN-pod persists its consented Stage-1 contributions to a storage
 * adapter (localStorage / AsyncStorage) and rehydrates on load, so consent + the verify-round approval no
 * longer have to happen in one session. All pod logic is delegated to InMemoryCentralPod; only the op-journal
 * is added here.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryCentralPod } from 'onderling-feedback/public';
import { buildContribution } from 'onderling-feedback/public';
import { makePersistentOwnPod } from '../../src/feedback/persistentPod.js';

// A fake AsyncStorage: async get/set over a Map (proves async adapters work + survives a "reload").
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, v); },
  };
}

const make = () => new InMemoryCentralPod();
const contrib = (id, text) => buildContribution({ id, text }, { lang: 'nl' });

describe('makePersistentOwnPod', () => {
  it('persists a consented contribution across a reload (fresh pod, same storage)', async () => {
    const storage = fakeStorage();
    const pod1 = await makePersistentOwnPod({ storage, key: 'fp.ownpod.p1', make });
    pod1.write('me', contrib('me:1', 'de stoep is stuk'));
    await pod1.flush();

    // reload: a brand-new pod built from the SAME storage rehydrates the journal
    const pod2 = await makePersistentOwnPod({ storage, key: 'fp.ownpod.p1', make });
    expect(pod2.list().map((e) => e.contribution.text)).toEqual(['de stoep is stuk']);
    expect(pod2.forAggregation()[0]).toMatchObject({ user: 'me', text: 'de stoep is stuk' });
  });

  it('a withdrawal also survives a reload', async () => {
    const storage = fakeStorage();
    const pod1 = await makePersistentOwnPod({ storage, key: 'k', make });
    pod1.write('me', contrib('me:1', 'eerste'));
    pod1.write('me', contrib('me:2', 'tweede'));
    pod1.withdraw('me', 'me:1');
    await pod1.flush();

    const pod2 = await makePersistentOwnPod({ storage, key: 'k', make });
    expect(pod2.list().map((e) => e.contribution.text)).toEqual(['tweede']);
    expect(pod2.getStatus('me:1')).toBe('withdrawn');
  });

  it('namespaces by key — two projects do not share state', async () => {
    const storage = fakeStorage();
    const a = await makePersistentOwnPod({ storage, key: 'proj-a', make });
    a.write('me', contrib('me:1', 'a-point'));
    await a.flush();
    const b = await makePersistentOwnPod({ storage, key: 'proj-b', make });
    expect(b.list()).toEqual([]);
  });

  it('corrupt storage degrades to an empty session pod (never throws)', async () => {
    const storage = fakeStorage({ bad: '{not json' });
    const pod = await makePersistentOwnPod({ storage, key: 'bad', make });
    expect(pod.list()).toEqual([]);
    pod.write('me', contrib('me:1', 'still works'));
    expect(pod.list()).toHaveLength(1);
  });

  it('delegates the write dedup guard (a duplicate id still throws, is not journalled)', async () => {
    const storage = fakeStorage();
    const pod = await makePersistentOwnPod({ storage, key: 'k', make });
    pod.write('me', contrib('me:1', 'x'));
    expect(() => pod.write('me', contrib('me:1', 'x again'))).toThrow(/duplicate/);
    await pod.flush();
    // the failed write left no residue → reload shows exactly one
    const reloaded = await makePersistentOwnPod({ storage, key: 'k', make });
    expect(reloaded.list()).toHaveLength(1);
  });
});

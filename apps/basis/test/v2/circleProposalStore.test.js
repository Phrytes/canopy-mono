/**
 * P6.2 — circleProposalStore tests.
 *
 * Pure: drives the store over a Map-backed IO adapter so vitest covers
 * every persistence branch without touching real storage.
 */
import { describe, it, expect } from 'vitest';
import {
  createProposalStore, localStorageProposalIo,
} from '../../src/v2/circleProposalStore.js';
import { makeProposal, approveProposal } from '../../src/v2/circleConsensus.js';

function makeIo(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    load: (k) => (map.has(k) ? map.get(k) : null),
    save: (k, v) => { map.set(k, v); },
  };
}

describe('createProposalStore', () => {
  it('rejects an io without load/save', () => {
    expect(() => createProposalStore({})).toThrow(/io must provide load \+ save/);
    expect(() => createProposalStore({ io: { load: () => null } }))
      .toThrow(/io must provide load \+ save/);
  });

  it('returns an empty list for a fresh circle', async () => {
    const s = createProposalStore({ io: makeIo() });
    expect(await s.listForCircle('selwerd')).toEqual([]);
    expect(await s.countPending('selwerd')).toBe(0);
  });

  it('saves + lists a proposal scoped to its circle', async () => {
    const io = makeIo();
    const s = createProposalStore({ io });
    const p = makeProposal({
      circleId: 'selwerd',
      patch: { pod: 'shared' },
      proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    await s.save(p);
    expect(await s.listForCircle('selwerd')).toEqual([p]);
    expect(await s.listForCircle('huisgenoten')).toEqual([]); // scope respected
  });

  it('replaces (not duplicates) on save when id matches', async () => {
    const s = createProposalStore({ io: makeIo() });
    const p = makeProposal({
      circleId: 'c',
      patch: { agents: 'no' },
      proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    await s.save(p);
    const approved = approveProposal(p, 'pieter');
    await s.save(approved);
    const list = await s.listForCircle('c');
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('ready');
  });

  it('sorts proposals oldest first', async () => {
    const s = createProposalStore({ io: makeIo() });
    const old = { id: 'p1', circleId: 'c', proposedAt: 100, status: 'pending', requiredApprovers: [], approvals: [] };
    const mid = { id: 'p2', circleId: 'c', proposedAt: 200, status: 'pending', requiredApprovers: [], approvals: [] };
    const fresh = { id: 'p3', circleId: 'c', proposedAt: 300, status: 'pending', requiredApprovers: [], approvals: [] };
    await s.save(mid);
    await s.save(fresh);
    await s.save(old);
    expect((await s.listForCircle('c')).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('remove deletes by id + cleans up the circle slot when empty', async () => {
    const io = makeIo();
    const s = createProposalStore({ io });
    const a = { id: 'a', circleId: 'c', proposedAt: 1, status: 'pending', requiredApprovers: [], approvals: [] };
    const b = { id: 'b', circleId: 'c', proposedAt: 2, status: 'pending', requiredApprovers: [], approvals: [] };
    await s.save(a); await s.save(b);
    await s.remove('a');
    expect((await s.listForCircle('c')).map((p) => p.id)).toEqual(['b']);
    await s.remove('b');
    expect(await s.listForCircle('c')).toEqual([]);
    // the circle key is now gone from the underlying map
    const raw = io.map.get('cc.circleProposals');
    expect(raw?.c).toBeUndefined();
  });

  it('updateOne mutates by id + returns the new shape', async () => {
    const s = createProposalStore({ io: makeIo() });
    const p = makeProposal({
      circleId: 'c',
      patch: { revealPolicy: 'open' },
      proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    await s.save(p);
    const updated = await s.updateOne(p.id, (cur) => approveProposal(cur, 'pieter'));
    expect(updated?.status).toBe('ready');
    expect((await s.listForCircle('c'))[0].status).toBe('ready');
  });

  it('updateOne returns null when id is unknown', async () => {
    const s = createProposalStore({ io: makeIo() });
    expect(await s.updateOne('does-not-exist', (p) => p)).toBeNull();
  });

  it('countPending excludes proposals already in `ready`', async () => {
    const s = createProposalStore({ io: makeIo() });
    const ready = makeProposal({
      circleId: 'c',
      patch: {},
      proposedBy: 'anne',
      policy: { admins: ['anne'], consensusRequired: false }, // single admin → ready immediately
    });
    const pending = makeProposal({
      circleId: 'c',
      patch: { pod: 'shared' },
      proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    await s.save(ready); await s.save(pending);
    expect(await s.countPending('c')).toBe(1);
  });
});

describe('localStorageProposalIo', () => {
  it('throws when no storage is available', () => {
    expect(() => localStorageProposalIo(null)).toThrow(/no localStorage available/);
  });

  it('round-trips through a stub storage', () => {
    const stub = (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, v); },
      };
    })();
    const io = localStorageProposalIo(stub);
    io.save('cc.circleProposals', { c: [{ id: 'x' }] });
    expect(io.load('cc.circleProposals')).toEqual({ c: [{ id: 'x' }] });
  });

  it('returns null on malformed JSON', () => {
    const broken = { getItem: () => '{not json', setItem: () => {} };
    const io = localStorageProposalIo(broken);
    expect(io.load('any')).toBeNull();
  });
});

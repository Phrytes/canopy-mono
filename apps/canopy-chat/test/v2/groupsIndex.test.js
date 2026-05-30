/**
 * Phase 5.6 — GroupsIndex + bindMemberMap.
 *
 * `GroupsIndex` is a pure data structure (sync, no IO), so the unit
 * tests cover add / remove edge cleanup + the two reverse-lookup paths.
 * `bindMemberMap` uses a stub event-emitter to prove the live-update
 * subscription mirrors MemberMap mutations into the index.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GroupsIndex, bindMemberMap } from '../../src/v2/groupsIndex.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const CAR  = 'https://id.example/carol';

describe('GroupsIndex — pure add/remove', () => {
  let idx;
  beforeEach(() => { idx = new GroupsIndex(); });

  it('add records both directions; groupsFor + membersOf round-trip', () => {
    idx.add('circle-a', ANNE);
    idx.add('circle-a', BOB);
    idx.add('circle-b', ANNE);

    expect(idx.groupsFor(ANNE).sort()).toEqual(['circle-a', 'circle-b']);
    expect(idx.groupsFor(BOB)).toEqual(['circle-a']);
    expect(idx.membersOf('circle-a').sort()).toEqual([ANNE, BOB].sort());
    expect(idx.membersOf('circle-b')).toEqual([ANNE]);
    expect(idx.has('circle-a', ANNE)).toBe(true);
    expect(idx.has('circle-a', CAR)).toBe(false);
  });

  it('add is idempotent', () => {
    idx.add('circle-a', ANNE);
    idx.add('circle-a', ANNE);
    expect(idx.membersOf('circle-a')).toEqual([ANNE]);
    expect(idx.groupsFor(ANNE)).toEqual(['circle-a']);
  });

  it('ignores blank circleId / webid', () => {
    idx.add('', ANNE);
    idx.add('circle-a', '');
    idx.add(null, ANNE);
    expect(idx.groupsFor(ANNE)).toEqual([]);
  });

  it('remove drops the edge AND prunes empty sets', () => {
    idx.add('circle-a', ANNE);
    idx.remove('circle-a', ANNE);
    expect(idx.groupsFor(ANNE)).toEqual([]);
    expect(idx.membersOf('circle-a')).toEqual([]);
  });

  it('removeCircle drops every edge in that circle', () => {
    idx.add('circle-a', ANNE);
    idx.add('circle-a', BOB);
    idx.add('circle-b', ANNE);

    idx.removeCircle('circle-a');

    expect(idx.membersOf('circle-a')).toEqual([]);
    expect(idx.groupsFor(ANNE)).toEqual(['circle-b']);
    expect(idx.groupsFor(BOB)).toEqual([]);          // sole circle gone
  });

  it('clear empties everything', () => {
    idx.add('circle-a', ANNE);
    idx.clear();
    expect(idx.groupsFor(ANNE)).toEqual([]);
    expect(idx.membersOf('circle-a')).toEqual([]);
  });
});

/**
 * Tiny MemberMap stub: list() returns the seeded array; on/off forward
 * to a Map<event, Set<handler>>; emit triggers handlers.  Enough to
 * prove bindMemberMap subscribes correctly.
 */
function makeStubMM(initial = []) {
  const handlers = new Map();
  return {
    list: async () => initial.slice(),
    on: (ev, fn) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev).add(fn);
    },
    off: (ev, fn) => { handlers.get(ev)?.delete(fn); },
    emit: (ev, payload) => {
      for (const fn of handlers.get(ev) ?? []) fn(payload);
    },
  };
}

describe('bindMemberMap — initial sync + live updates', () => {
  it('initial sync mirrors existing members into the index', async () => {
    const idx = new GroupsIndex();
    const mm  = makeStubMM([{ webid: ANNE }, { webid: BOB }]);
    await bindMemberMap(idx, 'circle-a', mm);
    expect(idx.membersOf('circle-a').sort()).toEqual([ANNE, BOB].sort());
  });

  it('member-added / member-removed events are mirrored', async () => {
    const idx = new GroupsIndex();
    const mm  = makeStubMM([]);
    await bindMemberMap(idx, 'circle-a', mm);

    mm.emit('member-added',   { webid: ANNE });
    mm.emit('member-updated', { webid: BOB });        // updates also add
    expect(idx.groupsFor(ANNE)).toEqual(['circle-a']);
    expect(idx.groupsFor(BOB)).toEqual(['circle-a']);

    mm.emit('member-removed', { webid: ANNE });
    expect(idx.groupsFor(ANNE)).toEqual([]);
    expect(idx.membersOf('circle-a')).toEqual([BOB]);
  });

  it('unbind drops the circle + stops further updates', async () => {
    const idx = new GroupsIndex();
    const mm  = makeStubMM([{ webid: ANNE }]);
    const unbind = await bindMemberMap(idx, 'circle-a', mm);

    unbind();
    expect(idx.membersOf('circle-a')).toEqual([]);    // removeCircle called

    mm.emit('member-added', { webid: BOB });           // ignored — unsubscribed
    expect(idx.groupsFor(BOB)).toEqual([]);
  });

  it('tolerates a memberMap without on/off (initial sync still works)', async () => {
    const idx = new GroupsIndex();
    await bindMemberMap(idx, 'circle-a', { list: async () => [{ webid: ANNE }] });
    expect(idx.membersOf('circle-a')).toEqual([ANNE]);
  });

  it('tolerates an array shorthand (no list() at all)', async () => {
    const idx = new GroupsIndex();
    await bindMemberMap(idx, 'circle-a', [{ webid: ANNE }, { webid: BOB }]);
    expect(idx.membersOf('circle-a').sort()).toEqual([ANNE, BOB].sort());
  });

  it('rejects an invalid index or circleId', async () => {
    await expect(bindMemberMap({}, 'circle-a', makeStubMM()))
      .rejects.toThrow(/GroupsIndex/);
    await expect(bindMemberMap(new GroupsIndex(), '', makeStubMM()))
      .rejects.toThrow(/circleId/);
  });
});

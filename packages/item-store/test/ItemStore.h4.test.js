/**
 * H4 (tasks) consumer profile — tasks with DAG dependencies, required
 * skills, claim flow with compare-and-swap, role-policy gate.
 *
 * Tests that the substrate cleanly expresses H4's V0 spec without
 * bending.  Per the rule-of-two, these specs run alongside H2's
 * (ItemStore.h2.test.js); together they validate the substrate's
 * API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ItemStore,

  PermissionDeniedError,
  InvalidLifecycleError,
} from '../src/index.js';
import { MemorySource } from "@canopy/core";

const ANNE  = 'https://id.inrupt.com/anne';
const FRITS = 'https://id.inrupt.com/frits';
const KID   = 'https://id.inrupt.com/kid';

// H4-style standard 5-role policy (simplified).  Fields the policy
// cares about: actor's role + task's visibility.  In this test we
// pass a roles map to the policy via closure.
function buildH4Policy(roles) {
  return {
    canAdd:        (actor) => roles[actor] !== 'observer',
    canClaim:      (actor) => ['admin', 'coordinator', 'member'].includes(roles[actor]),
    canComplete:   (actor, item) => {
      const role = roles[actor];
      if (role === 'observer') return false;
      // member can only complete their own assigned tasks
      if (role === 'member') return item.assignee === actor;
      return true;        // admin / coordinator
    },
    canReassign:   (actor) => ['admin', 'coordinator'].includes(roles[actor]),
    canRemove:     (actor) => roles[actor] === 'admin',
    canEditBody:   (actor, item) => {
      const role = roles[actor];
      if (role === 'observer') return false;
      // members can only edit tasks they added
      if (role === 'member') return item.addedBy === actor;
      return true;
    },
    canRead:       (actor) => roles[actor] !== undefined,    // any known member
  };
}

describe('H4 — task with skill + dependency + due', () => {
  let store;
  beforeEach(() => {
    store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
  });

  it('persists all H4-extension fields', async () => {
    const [task] = await store.addItems(
      [
        {
          type:           'task',
          text:           'Repaint the hallway',
          notes:          'Use the off-white from the basement',
          dependencies:   ['01HXSAMPLE-DEP-1'],
          requiredSkills: ['paint', 'ladder-7ft'],
          dueAt:          1714200000000,
          visibility:     'household',
        },
      ],
      { actor: ANNE, actorDisplayName: 'Anne' },
    );
    expect(task.dependencies).toEqual(['01HXSAMPLE-DEP-1']);
    expect(task.requiredSkills).toEqual(['paint', 'ladder-7ft']);
    expect(task.dueAt).toBe(1714200000000);
    expect(task.visibility).toBe('household');
    expect(task.notes).toBe('Use the off-white from the basement');
  });
});

describe('H4 — claim (compare-and-swap on assignee)', () => {
  let store;
  let task;
  beforeEach(async () => {
    store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    [task] = await store.addItems(
      [{ type: 'task', text: 'Vacuum living room' }],
      { actor: ANNE },
    );
  });

  it('first claim wins; assignee + claimedAt set', async () => {
    const result = await store.claim(task.id, { actor: ANNE });
    expect(result.assignee).toBe(ANNE);
    expect(result.claimedAt).toBeTypeOf('number');
    expect(result.error).toBeUndefined();
  });

  it('second claim returns {error: already-claimed, current}', async () => {
    await store.claim(task.id, { actor: ANNE });
    const result = await store.claim(task.id, { actor: FRITS });
    expect(result.error).toBe('already-claimed');
    expect(result.current.assignee).toBe(ANNE);
  });

  it('emits item-claimed only on successful claim', async () => {
    const events = [];
    store.on('item-claimed', (it) => events.push(it.assignee));
    await store.claim(task.id, { actor: ANNE });
    await store.claim(task.id, { actor: FRITS });    // loses
    expect(events).toEqual([ANNE]);
  });

  it('throws InvalidLifecycleError when claiming a completed task', async () => {
    await store.claim(task.id, { actor: ANNE });
    await store.markComplete([{ id: task.id }], { actor: ANNE });
    await expect(
      store.claim(task.id, { actor: FRITS }),
    ).rejects.toThrow(InvalidLifecycleError);
  });
});

describe('H4 — reassign (role-policy-gated)', () => {
  it('admin can reassign; member cannot', async () => {
    const roles = { [ANNE]: 'admin', [FRITS]: 'member' };
    const store = new ItemStore({
      dataSource: new MemorySource(), rootContainer: 'mem://h4/',
      rolePolicy: buildH4Policy(roles),
    });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'Buy paint' }], { actor: ANNE },
    );
    await store.claim(task.id, { actor: FRITS });

    // member tries to reassign — denied
    await expect(
      store.reassign(task.id, ANNE, { actor: FRITS }),
    ).rejects.toThrow(PermissionDeniedError);

    // admin reassigns — allowed
    const reassigned = await store.reassign(task.id, ANNE, { actor: ANNE });
    expect(reassigned.assignee).toBe(ANNE);
  });

  it('release (reassign to null) clears assignee + claimedAt', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'x' }], { actor: ANNE },
    );
    await store.claim(task.id, { actor: ANNE });
    const released = await store.reassign(task.id, null, { actor: ANNE });
    expect(released.assignee).toBeUndefined();
    expect(released.claimedAt).toBeUndefined();
  });
});

describe('H4 — role policy gates', () => {
  it('observer cannot add', async () => {
    const roles = { [KID]: 'observer' };
    const store = new ItemStore({
      dataSource: new MemorySource(), rootContainer: 'mem://h4/',
      rolePolicy: buildH4Policy(roles),
    });
    await expect(
      store.addItems([{ type: 'task', text: 'x' }], { actor: KID }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('member can only complete their own assigned tasks', async () => {
    const roles = { [ANNE]: 'admin', [FRITS]: 'member', [KID]: 'member' };
    const store = new ItemStore({
      dataSource: new MemorySource(), rootContainer: 'mem://h4/',
      rolePolicy: buildH4Policy(roles),
    });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'paint' }], { actor: ANNE },
    );
    await store.claim(task.id, { actor: FRITS });

    // KID (a different member) cannot complete it
    await expect(
      store.markComplete([{ id: task.id }], { actor: KID }),
    ).rejects.toThrow(PermissionDeniedError);

    // FRITS (the assignee) can complete it
    const [done] = await store.markComplete([{ id: task.id }], { actor: FRITS });
    expect(done.completedBy).toBe(FRITS);
  });

  it('only admin can hard-remove tasks', async () => {
    const roles = { [ANNE]: 'admin', [FRITS]: 'coordinator', [KID]: 'member' };
    const store = new ItemStore({
      dataSource: new MemorySource(), rootContainer: 'mem://h4/',
      rolePolicy: buildH4Policy(roles),
    });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'x' }], { actor: ANNE },
    );
    for (const actor of [FRITS, KID]) {
      await expect(
        store.removeItems([{ id: task.id }], { actor }),
      ).rejects.toThrow(PermissionDeniedError);
    }
    const removed = await store.removeItems([{ id: task.id }], { actor: ANNE });
    expect(removed).toEqual([task.id]);
  });
});

describe('H4 — filter by skill / assignee / visibility', () => {
  it('listOpen({requiredSkill}) returns matching tasks', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    await store.addItems(
      [
        { type: 'task', text: 'paint hallway',  requiredSkills: ['paint']  },
        { type: 'task', text: 'fix tap',        requiredSkills: ['plumb']  },
        { type: 'task', text: 'paint kitchen',  requiredSkills: ['paint']  },
      ],
      { actor: ANNE },
    );
    const painters = await store.listOpen({ requiredSkill: 'paint' });
    expect(painters).toHaveLength(2);
    expect(painters.every((t) => t.requiredSkills.includes('paint'))).toBe(true);
  });

  it('listOpen({assignee: null}) returns unassigned tasks', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    const [a, b] = await store.addItems(
      [
        { type: 'task', text: 'a' },
        { type: 'task', text: 'b' },
      ],
      { actor: ANNE },
    );
    await store.claim(a.id, { actor: FRITS });
    const unassigned = await store.listOpen({ assignee: null });
    expect(unassigned.map((t) => t.text)).toEqual(['b']);
  });

  it('listOpen({assignee: webid}) returns tasks assigned to that webid', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    const [a] = await store.addItems(
      [{ type: 'task', text: 'a' }, { type: 'task', text: 'b' }],
      { actor: ANNE },
    );
    await store.claim(a.id, { actor: FRITS });
    const frits = await store.listOpen({ assignee: FRITS });
    expect(frits).toHaveLength(1);
  });
});

describe('H4 — update body fields (LWW)', () => {
  it('updates editable fields', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'paint' }], { actor: ANNE },
    );
    const updated = await store.update(
      task.id,
      { text: 'paint hallway', dueAt: 1714200000000 },
      { actor: ANNE },
    );
    expect(updated.text).toBe('paint hallway');
    expect(updated.dueAt).toBe(1714200000000);
    expect(updated.addedBy).toBe(ANNE);              // unchanged
  });

  it('forbids edits to attribution / completion / assignment via update()', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h4/' });
    const [task] = await store.addItems(
      [{ type: 'task', text: 'x' }], { actor: ANNE },
    );
    for (const f of ['addedBy', 'addedAt', 'completedAt', 'assignee', 'claimedAt']) {
      await expect(
        store.update(task.id, { [f]: 'whatever' }, { actor: ANNE }),
      ).rejects.toThrow(/not editable/);
    }
  });
});

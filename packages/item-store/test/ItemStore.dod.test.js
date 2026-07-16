/**
 * Phase 5 (Tasks V1) — DoD lifecycle on item-store.
 *
 * Substrate-level tests of the new submit / approve / reject /
 * revoke transitions + computeStatus + new schema fields. App-side
 * role-policy + skill wiring tested separately in
 * `apps/tasks-v0/test/phase5-dod.test.js`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { MemorySource } from '@onderling/core';
import {
  ItemStore,
  computeStatus,
  InvalidLifecycleError,
  MissingArgumentError,
} from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CAROL = 'https://id.example/carol';

let store;
beforeEach(() => {
  store = new ItemStore({
    dataSource:    new MemorySource(),
    rootContainer: 'mem://t/',
  });
});

async function addTask(extra = {}, actor = ANNE) {
  const [item] = await store.addItems([{
    type: 'task',
    text: 'Do the thing',
    ...extra,
  }], { actor });
  return item;
}

async function claim(itemId, actor) {
  return store.claim(itemId, { actor });
}

describe('Phase 5 — schema additions on add', () => {
  it('defaults `master` to addedBy when absent on add', async () => {
    const item = await addTask({}, ANNE);
    expect(item.master).toBe(ANNE);
  });

  it('honours an explicit `master` (e.g. spawned sub-task)', async () => {
    const item = await addTask({ master: BOB }, ANNE);
    expect(item.master).toBe(BOB);
  });

  it('honours `definitionOfDone`, `approval`, `parentTaskId`', async () => {
    const item = await addTask({
      definitionOfDone: 'fence is painted',
      approval:         'creator',
      parentTaskId:     '01ABC',
    });
    expect(item.definitionOfDone).toBe('fence is painted');
    expect(item.approval).toBe('creator');
    expect(item.parentTaskId).toBe('01ABC');
  });

  it('does NOT add the new optional fields when not requested (V0 backward compat)', async () => {
    const item = await addTask();
    expect(item.definitionOfDone).toBeUndefined();
    expect(item.approval).toBeUndefined();
    expect(item.deliverable).toBeUndefined();
    expect(item.reviewLog).toBeUndefined();
    expect(item.parentTaskId).toBeUndefined();
  });
});

describe('Phase 5 — computeStatus', () => {
  it('returns "open" for a fresh item', async () => {
    const item = await addTask();
    expect(computeStatus(item)).toBe('open');
  });

  it('returns "claimed" after claim', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    const after = await store.getById(item.id);
    expect(computeStatus(after)).toBe('claimed');
  });

  it('returns "submitted" after submit', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    const after = await store.getById(item.id);
    expect(computeStatus(after)).toBe('submitted');
  });

  it('returns "rejected" after reject', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    await store.reject(item.id, { note: 'photo missing' }, { actor: ANNE });
    const after = await store.getById(item.id);
    expect(computeStatus(after)).toBe('rejected');
  });

  it('returns "complete" after approve', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    await store.approve(item.id, {}, { actor: ANNE });
    const after = await store.getById(item.id);
    expect(computeStatus(after)).toBe('complete');
  });
});

describe('Phase 5 — submit/approve/reject lifecycle', () => {
  it('submit: claimed → submitted, appends reviewLog, emits event, attaches deliverable', async () => {
    const item = await addTask();
    await claim(item.id, BOB);

    let emitted;
    store.on('item-submitted', (i) => { emitted = i; });

    const updated = await store.submit(item.id, {
      deliverable: { kind: 'pod-resource', ref: 'pod://...' },
      note:        'done',
    }, { actor: BOB });

    expect(updated.reviewLog).toHaveLength(1);
    expect(updated.reviewLog[0].decision).toBe('submit');
    expect(updated.reviewLog[0].by).toBe(BOB);
    expect(updated.reviewLog[0].note).toBe('done');
    expect(updated.deliverable.kind).toBe('pod-resource');
    expect(updated.deliverable.submittedAt).toBeGreaterThan(0);
    expect(emitted).toBe(updated);
  });

  it('submit refuses to operate on an unclaimed item', async () => {
    const item = await addTask();
    await expect(store.submit(item.id, {}, { actor: BOB }))
      .rejects.toBeInstanceOf(InvalidLifecycleError);
  });

  it('approve: submitted → complete, sets completedAt + completedBy, emits item-completed', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });

    let emitted;
    store.on('item-completed', (i) => { emitted = i; });

    const updated = await store.approve(item.id, { note: 'looks good' }, { actor: ANNE });
    expect(updated.completedAt).toBeGreaterThan(0);
    expect(updated.completedBy).toBe(ANNE);
    expect(updated.reviewLog.map((r) => r.decision)).toEqual(['submit', 'approve']);
    expect(emitted).toBe(updated);
  });

  it('approve refuses if not yet submitted', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await expect(store.approve(item.id, {}, { actor: ANNE }))
      .rejects.toBeInstanceOf(InvalidLifecycleError);
  });

  it('reject: submitted → rejected, requires note, item stays open (no completedAt)', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });

    await expect(store.reject(item.id, {}, { actor: ANNE }))
      .rejects.toBeInstanceOf(MissingArgumentError);
    await expect(store.reject(item.id, { note: '   ' }, { actor: ANNE }))
      .rejects.toBeInstanceOf(MissingArgumentError);

    const updated = await store.reject(item.id, { note: 'photo missing' }, { actor: ANNE });
    expect(updated.completedAt).toBeUndefined();
    expect(updated.reviewLog.map((r) => r.decision)).toEqual(['submit', 'reject']);
    expect(computeStatus(updated)).toBe('rejected');
  });

  it('after reject, assignee can submit again — reviewLog grows append-only', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    await store.reject(item.id, { note: 'try harder' }, { actor: ANNE });
    const after2 = await store.submit(item.id, {
      deliverable: { kind: 'note', ref: 'second attempt' },
    }, { actor: BOB });
    expect(after2.reviewLog.map((r) => r.decision)).toEqual(['submit', 'reject', 'submit']);
    expect(computeStatus(after2)).toBe('submitted');
  });
});

describe('Phase 5 — revoke lifecycle', () => {
  it('revoke: claimed → open, requires reason, preserves master', async () => {
    const item = await addTask({ master: ANNE });
    await claim(item.id, BOB);

    await expect(store.revoke(item.id, {}, { actor: ANNE }))
      .rejects.toBeInstanceOf(MissingArgumentError);

    let emittedReason;
    let emittedPrev;
    store.on('item-revoked', (e) => {
      emittedReason = e.reason;
      emittedPrev   = e.previousAssignee;
    });

    const updated = await store.revoke(item.id, { reason: 'overcommitted' }, { actor: ANNE });
    expect(updated.assignee).toBeUndefined();
    expect(updated.claimedAt).toBeUndefined();
    expect(updated.master).toBe(ANNE);
    expect(updated.reviewLog.map((r) => r.decision)).toEqual(['revoke']);
    expect(updated.reviewLog[0].note).toBe('overcommitted');
    expect(computeStatus(updated)).toBe('open');
    expect(emittedReason).toBe('overcommitted');
    expect(emittedPrev).toBe(BOB);
  });

  it('revoke refuses on an unclaimed item', async () => {
    const item = await addTask();
    await expect(store.revoke(item.id, { reason: 'x' }, { actor: ANNE }))
      .rejects.toBeInstanceOf(InvalidLifecycleError);
  });

  it('after revoke, the previous assignee is gone — a fresh claim succeeds', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.revoke(item.id, { reason: 'x' }, { actor: ANNE });
    const claimResult = await claim(item.id, CAROL);
    expect(claimResult.assignee).toBe(CAROL);
  });

  it('revoke after a previous submit lands at status=open (revoke clears the submit)', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    const updated = await store.revoke(item.id, { reason: 'taking over' }, { actor: ANNE });
    expect(computeStatus(updated)).toBe('open');
    // reviewLog preserves history: submit then revoke.
    expect(updated.reviewLog.map((r) => r.decision)).toEqual(['submit', 'revoke']);
  });
});

describe('Phase 5 — setApprovalMode + audit', () => {
  it('setApprovalMode rejects bogus modes', async () => {
    const item = await addTask();
    await expect(store.setApprovalMode(item.id, 'maybe-later', { actor: ANNE }))
      .rejects.toThrow(/invalid mode/);
    await expect(store.setApprovalMode(item.id, 'webid:', { actor: ANNE }))
      .rejects.toThrow(/invalid mode/);
  });

  it('setApprovalMode accepts the three valid shapes', async () => {
    const item = await addTask();
    const a1 = await store.setApprovalMode(item.id, 'self-mark', { actor: ANNE });
    expect(a1.approval).toBe('self-mark');
    const a2 = await store.setApprovalMode(item.id, 'creator', { actor: ANNE });
    expect(a2.approval).toBe('creator');
    const a3 = await store.setApprovalMode(item.id, `webid:${CAROL}`, { actor: ANNE });
    expect(a3.approval).toBe(`webid:${CAROL}`);
  });

  it('audit log records submit/approve/reject/revoke with the right action codes', async () => {
    const item = await addTask();
    await claim(item.id, BOB);
    await store.submit(item.id, {}, { actor: BOB });
    await store.reject(item.id, { note: 'r' }, { actor: ANNE });
    await store.submit(item.id, {}, { actor: BOB });
    await store.approve(item.id, {}, { actor: ANNE });

    const log = await store.auditLog({ itemId: item.id });
    const actions = log.map((e) => e.action);
    expect(actions).toContain('add');
    expect(actions).toContain('claim');
    expect(actions).toContain('submit');
    expect(actions).toContain('reject');
    expect(actions).toContain('approve');
  });
});

describe('Phase 5 — backward compat with V0 markComplete', () => {
  it('items without `approval` still work via markComplete (V0 path unchanged)', async () => {
    const item = await addTask();
    await store.markComplete([{ id: item.id }], { actor: ANNE });
    const after = await store.getById(item.id);
    expect(after.completedAt).toBeGreaterThan(0);
    expect(computeStatus(after)).toBe('complete');
    // No reviewLog written by markComplete (V0 path doesn't touch DoD fields).
    expect(after.reviewLog).toBeUndefined();
  });

  it('update() refuses to touch the protected DoD fields', async () => {
    const item = await addTask();
    await expect(store.update(item.id, { reviewLog: [] }, { actor: ANNE }))
      .rejects.toThrow(/reviewLog/);
    await expect(store.update(item.id, { deliverable: { kind: 'note', ref: 'x' } }, { actor: ANNE }))
      .rejects.toThrow(/deliverable/);
    await expect(store.update(item.id, { approval: 'creator' }, { actor: ANNE }))
      .rejects.toThrow(/approval/);
    await expect(store.update(item.id, { master: BOB }, { actor: ANNE }))
      .rejects.toThrow(/master/);
    await expect(store.update(item.id, { parentTaskId: '01X' }, { actor: ANNE }))
      .rejects.toThrow(/parentTaskId/);
  });
});

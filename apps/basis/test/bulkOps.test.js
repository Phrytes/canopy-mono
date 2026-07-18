/**
 * basis — bulk-op fan-out tests. v0.2.
 */
import { describe, it, expect, vi } from 'vitest';

import { runBulkOp, summariseBulkOp } from '../src/bulkOps.js';
import { Thread }                     from '../src/thread.js';

describe('runBulkOp — happy path', () => {
  it("fires callSkill once per item; collects successes", async () => {
    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push({ appOrigin, opId, args });
      return { ok: true, itemId: args.choreId };
    };
    const r = await runBulkOp({
      opId: 'markComplete', appOrigin: 'household',
      items: [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }],
      argName: 'choreId',
      callSkill,
    });
    expect(calls.length).toBe(3);
    expect(calls).toEqual([
      { appOrigin: 'household', opId: 'markComplete', args: { choreId: 'c-1' } },
      { appOrigin: 'household', opId: 'markComplete', args: { choreId: 'c-2' } },
      { appOrigin: 'household', opId: 'markComplete', args: { choreId: 'c-3' } },
    ]);
    expect(r.stats).toEqual({ total: 3, ok: 3, failed: 0 });
    expect(r.successes.map((s) => s.itemId)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(r.failures).toEqual([]);
  });

  it('merges baseArgs into each per-item call', async () => {
    const calls = [];
    await runBulkOp({
      opId: 'archiveTask', appOrigin: 'tasks',
      items: [{ id: 't-1' }, { id: 't-2' }],
      argName: 'taskId',
      baseArgs: { reason: 'sprint-end' },
      callSkill: async (a, o, args) => { calls.push(args); return { ok: true }; },
    });
    expect(calls).toEqual([
      { taskId: 't-1', reason: 'sprint-end' },
      { taskId: 't-2', reason: 'sprint-end' },
    ]);
  });
});

describe('runBulkOp — failure handling', () => {
  it("payload.ok === false → recorded as failure", async () => {
    const r = await runBulkOp({
      opId: 'markComplete', appOrigin: 'household',
      items: [{ id: 'c-1' }, { id: 'c-2' }],
      argName: 'choreId',
      callSkill: async (a, o, args) => {
        if (args.choreId === 'c-1') return { ok: false, error: 'already done' };
        return { ok: true };
      },
    });
    expect(r.stats).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(r.failures[0]).toEqual({
      itemId: 'c-1',
      error: { code: 'skill-returned-not-ok', message: 'already done' },
    });
  });

  it("thrown errors → recorded as failure (skill keeps running)", async () => {
    const r = await runBulkOp({
      opId: 'op', appOrigin: 'app',
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      argName: 'id',
      callSkill: async (a, o, args) => {
        if (args.id === 'b') throw new Error('peer offline');
        return { ok: true };
      },
    });
    expect(r.stats).toEqual({ total: 3, ok: 2, failed: 1 });
    expect(r.failures[0]).toEqual({
      itemId: 'b',
      error: { code: 'dispatch-error', message: 'peer offline' },
    });
    expect(r.successes.map((s) => s.itemId).sort()).toEqual(['a', 'c']);
  });

  it("custom err.code is preserved", async () => {
    const e = new Error('forbidden'); e.code = 'unauthorised';
    const r = await runBulkOp({
      opId: 'op', appOrigin: 'app',
      items: [{ id: 'x' }],
      argName: 'id',
      callSkill: async () => { throw e; },
    });
    expect(r.failures[0].error.code).toBe('unauthorised');
  });

  it("empty items array → empty result, no callSkill calls", async () => {
    const callSkill = vi.fn();
    const r = await runBulkOp({
      opId: 'op', appOrigin: 'a',
      items: [], argName: 'id', callSkill,
    });
    expect(callSkill).not.toHaveBeenCalled();
    expect(r.stats).toEqual({ total: 0, ok: 0, failed: 0 });
  });
});

describe('runBulkOp — input validation', () => {
  it.each([
    [null,                   /request required/],
    [{},                     /opId required/],
    [{ opId: 'x' },          /appOrigin required/],
    [{ opId: 'x', appOrigin: 'a' }, /argName required/],
    [{ opId: 'x', appOrigin: 'a', argName: 'id' }, /callSkill required/],
    [{ opId: 'x', appOrigin: 'a', argName: 'id', callSkill: () => {} }, /items must be an array/],
  ])('rejects %o', async (req, pattern) => {
    await expect(runBulkOp(req)).rejects.toThrow(pattern);
  });
});

describe('runBulkOp — emitEvent fan-out (OQ-4)', () => {
  it('fires emitEvent per successful item', async () => {
    const events = [];
    await runBulkOp({
      opId: 'markComplete', appOrigin: 'household',
      items: [{ id: 'c-1' }, { id: 'c-2' }],
      argName: 'choreId',
      callSkill: async () => ({ ok: true }),
      emitEvent: (e) => events.push(e),
    });
    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({
      app: 'household',
      type: 'item-changed',
      itemRef: { app: 'household', type: 'item', id: 'c-1' },
    });
    expect(events[0].payload.message).toMatch(/household\.markComplete\(c-1\)/);
  });

  it("does NOT emit for failed items", async () => {
    const events = [];
    await runBulkOp({
      opId: 'op', appOrigin: 'app',
      items: [{ id: 'good' }, { id: 'bad' }],
      argName: 'id',
      callSkill: async (a, o, args) => {
        return args.id === 'bad' ? { ok: false, error: 'no' } : { ok: true };
      },
      emitEvent: (e) => events.push(e),
    });
    expect(events.length).toBe(1);
    expect(events[0].itemRef.id).toBe('good');
  });

  it("swallows emitEvent errors (don't break bulk completion)", async () => {
    const r = await runBulkOp({
      opId: 'op', appOrigin: 'app',
      items: [{ id: 'x' }],
      argName: 'id',
      callSkill: async () => ({ ok: true }),
      emitEvent: () => { throw new Error('router broken'); },
    });
    expect(r.stats.ok).toBe(1);
  });
});

describe('summariseBulkOp', () => {
  it("all-success message", () => {
    const r = { successes: [{}, {}], failures: [], stats: { total: 2, ok: 2, failed: 0 } };
    expect(summariseBulkOp(r, { opLabel: 'Done' })).toEqual({
      message: '✓ Done: 2/2 items.', ok: true,
    });
  });

  it("all-failed message includes per-item reasons", () => {
    const r = {
      successes: [],
      failures: [
        { itemId: 'a', error: { message: 'x' } },
        { itemId: 'b', error: { message: 'y' } },
      ],
      stats: { total: 2, ok: 0, failed: 2 },
    };
    const out = summariseBulkOp(r, { opLabel: 'Archive' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/✗ Archive: all 2 items failed/);
    expect(out.message).toMatch(/  • a: x/);
    expect(out.message).toMatch(/  • b: y/);
  });

  it("partial-failed message", () => {
    const r = {
      successes: [{ itemId: 'a' }],
      failures:  [{ itemId: 'b', error: { message: 'no' } }],
      stats:     { total: 2, ok: 1, failed: 1 },
    };
    const out = summariseBulkOp(r);
    expect(out.message).toMatch(/⚠ Bulk op: 1\/2 succeeded, 1 failed/);
    expect(out.message).toMatch(/  • b: no/);
  });
});

describe('Thread.resolveAllListed (extension for bulk ops)', () => {
  it('returns every item id in the most-recent listing', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [
        { id: 'c-1', label: 'A' },
        { id: 'c-2', label: 'B' },
        { id: 'c-3', label: 'C' },
      ],
    }, { opId: 'listOpen' });
    expect(t.resolveAllListed('listOpen')).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('returns null when no listing cached for that opId', () => {
    const t = new Thread();
    expect(t.resolveAllListed('nothing')).toBeNull();
  });

  it("the LATEST listing wins (mirrors lastListingFor / resolveFuzzy)", () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [{ id: 'a' }, { id: 'b' }],
    }, { opId: 'listOpen' });
    t.addShellMessage({
      kind: 'list', messageId: 'm-2', lifecycleState: 'live',
      items: [{ id: 'x' }],
    }, { opId: 'listOpen' });
    expect(t.resolveAllListed('listOpen')).toEqual(['x']);
  });
});

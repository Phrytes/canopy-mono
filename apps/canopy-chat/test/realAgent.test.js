/**
 * canopy-chat — real Agent integration test.  v0.1.5 / OQ-1.C.
 *
 * Exercises the actual @canopy/core Agent class (NOT the mock) via
 * the InternalTransport bus.  Proves:
 *   - AgentIdentity.generate works
 *   - VaultMemory works
 *   - Agent.register + Agent.invoke roundtrip works
 *   - canopy-chat's callSkill interface still surfaces the right
 *     payload shape to the dispatch pipeline
 *
 * Same household ops as mockAgent — substitutable.  This test runs
 * in the node env (default vitest); the same code also runs in the
 * browser bundle (verified by `vite build` + the dev-server smoke).
 */
import { describe, it, expect } from 'vitest';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('createRealHouseholdAgent — Agent boot + skill dispatch', () => {
  it("listOpen returns 3 seed chores via real Agent.invoke roundtrip", async () => {
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('household', 'listOpen', {});
    expect(r.items.length).toBe(3);
    expect(r.items.map((c) => c.label).sort()).toEqual([
      'Bins out', 'Dishwasher', 'Vacuum living room',
    ]);
  });

  it("markComplete flips state + listOpen reflects it", async () => {
    const a = await createRealHouseholdAgent();
    const done = await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    // v0.6 — reply now includes _sync envelope; use toMatchObject to
    // tolerate the extra field.
    expect(done).toMatchObject({
      ok: true, message: '✓ Done: Dishwasher', itemId: 'c-1',
    });
    const list = await a.callSkill('household', 'listOpen', {});
    expect(list.items.length).toBe(2);
    expect(list.items.find((c) => c.id === 'c-1')).toBeUndefined();
  });

  it("markComplete with unknown id returns ok:false", async () => {
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('household', 'markComplete', { choreId: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No chore with id/);
  });

  it("meta exposes host + chat agent addresses + transport name", async () => {
    const a = await createRealHouseholdAgent();
    expect(typeof a.meta.hostAddress).toBe('string');
    expect(a.meta.hostAddress.length).toBeGreaterThan(0);
    expect(a.meta.chatAddress).not.toBe(a.meta.hostAddress);   // distinct identities
    expect(a.meta.transport).toBe('internal');
  });

  it('reset() restores chore state', async () => {
    const a = await createRealHouseholdAgent();
    await a.callSkill('household', 'markComplete', { choreId: 'c-1' });
    expect(a.state().find((c) => c.id === 'c-1').state).toBe('done');
    a.reset();
    expect(a.state().find((c) => c.id === 'c-1').state).toBe('open');
  });

  it("rejects unknown appOrigin", async () => {
    const a = await createRealHouseholdAgent();
    await expect(a.callSkill('stoop', 'listOpen', {})).rejects.toThrow(
      /unknown appOrigin/,
    );
  });
});

describe('createRealHouseholdAgent — pipeline integration', () => {
  it("works as a drop-in for mockAgent in the canopy-chat pipeline", async () => {
    const {
      parseInput, mergeManifests, resolveDispatch, runDispatch,
      renderReply, Thread,
    } = await import('../src/index.js');

    const a = await createRealHouseholdAgent();
    const catalog = mergeManifests([{ manifest: a.manifest }]);
    const thread  = new Thread();

    // /mine
    thread.addUserMessage('/mine');
    const r1 = resolveDispatch(parseInput('/mine', catalog), catalog);
    const reply1 = await runDispatch(r1, a.callSkill);
    const rendered1 = renderReply(reply1, {
      appOrigin: r1.appOrigin,
      manifestsByOrigin: { household: a.manifest },
    });
    thread.addShellMessage(rendered1, { opId: r1.opId });
    expect(rendered1.kind).toBe('list');
    expect(rendered1.items.length).toBe(3);

    // /done c-1
    thread.addUserMessage('/done c-1');
    const r2 = resolveDispatch(parseInput('/done c-1', catalog), catalog);
    const reply2 = await runDispatch(r2, a.callSkill);
    const rendered2 = renderReply(reply2);
    thread.addShellMessage(rendered2);
    expect(rendered2.kind).toBe('text');
    expect(rendered2.text).toBe('✓ Done: Dishwasher');
  });
});

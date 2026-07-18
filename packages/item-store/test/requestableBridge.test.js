/**
 * REQUESTABLE BRIDGE convergence — P4b · journey J6.
 * Design: plans/NOTE-skills-vs-capabilities.md (volleys 2–4) + PLAN-cluster-verification-journeys.md J6.
 *
 * Proves the convergence "a request to a human IS a task":
 *   • invoking a requestable skill CREATES A TASK (not an action) carrying the
 *     request text + the requester + the recipient, and resolves to a PENDING ref;
 *   • that task is claimable/acceptable by the recipient via the EXISTING lifecycle
 *     (accept == `claim` → assignee = recipient);
 *   • a NON-requestable offering produces NO handler (the guard).
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';

import { CircleItemStore } from '../src/CircleItemStore.js';
import { createTaskStore } from '../src/createTaskStore.js';
import {
  requestableSkillHandler, offeringsToSkillDefinitions,
  REQUEST_TASK_KIND, REQUEST_SOURCE_KIND,
} from '../src/requestableBridge.js';

const ROOT   = 'pod://circle/';
const CIRCLE = 'circle:hofje';
const ANNE   = 'https://id.example/anne';   // A — the requester
const BOB    = 'https://id.example/bob';    // B — holds the offering (recipient)

const mkTaskStore = () =>
  createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT }));

const LEAK_OFFERING = { key: 'skill', text: 'fix leaks', tags: ['plumbing'] };

// ── Minimal stand-in for agent-registry's disclosure policy + isRequestable ──
// (item-store stays decoupled from agent-registry; the shape mirrors
// disclosure.js: perContext[ctx][key].requestable). The host injects the real one.
const mkPolicy = (perContext) => ({ perContext });
const isRequestable = (policy, contextId, key) =>
  policy?.perContext?.[contextId]?.[key]?.requestable === true;

// ── 1. Invocation CREATES A TASK carrying the request + requester ────────────

describe('requestableSkillHandler — invocation → task (not an action)', () => {
  it('creates a request-task carrying the request text, requester + recipient; returns a PENDING ref', async () => {
    const taskStore = mkTaskStore();
    const handler = requestableSkillHandler({
      taskStore, offering: LEAK_OFFERING, recipient: BOB, contextId: CIRCLE,
    });

    // A (Anne) invokes B's requestable skill.
    const res = await handler({ from: ANNE, requestText: 'Kun je mijn lek maken?' });

    // Resolves to a PENDING task reference — NOT an action result.
    expect(res.created).toBe(true);
    expect(res.status).toBe('pending');
    expect(typeof res.taskId).toBe('string');

    // The task persisted, carrying the request + who asked + who it's for.
    const task = await taskStore.getById(res.taskId);
    expect(task).toBeTruthy();
    expect(task.kind).toBe(REQUEST_TASK_KIND);
    expect(task.text).toBe('Kun je mijn lek maken?');
    expect(task.source.kind).toBe(REQUEST_SOURCE_KIND);
    expect(task.source.requestedBy).toBe(ANNE);
    expect(task.source.forMember).toBe(BOB);
    expect(task.source.humanInTheLoop).toBe('required');
    expect(task.source.offering).toMatchObject({ key: 'skill', text: 'fix leaks' });
    expect(task.source.contextId).toBe(CIRCLE);

    // It is NOT completed/assigned — nothing executed; it's an open request.
    expect(task.completedAt ?? null).toBeNull();
    expect(task.assignee ?? null).toBeNull();
  });

  it('does NOT execute the offering — only a task is minted (no side effect ran)', async () => {
    const taskStore = mkTaskStore();
    let ran = false;
    // An "offering handler" that WOULD act if executed — the bridge must never call it.
    const offering = { key: 'skill', text: 'fix leaks', run: () => { ran = true; } };
    const handler = requestableSkillHandler({ taskStore, offering, recipient: BOB, contextId: CIRCLE });

    await handler({ from: ANNE });
    expect(ran).toBe(false);                                   // the offering was never run
    expect((await taskStore.listOpen({ type: 'task' })).length).toBe(1);   // just the request-task
  });

  it('derives a request phrase from the offering when none is supplied', async () => {
    const taskStore = mkTaskStore();
    const handler = requestableSkillHandler({ taskStore, offering: LEAK_OFFERING, recipient: BOB });
    const { taskId } = await handler({ from: ANNE });
    const task = await taskStore.getById(taskId);
    expect(task.text).toContain('fix leaks');
    expect(task.text).toContain(ANNE);                         // "<from> asks: fix leaks"
  });

  it('honours an invocation-time requester over a bound default; requires a requester somewhere', async () => {
    const taskStore = mkTaskStore();
    const handler = requestableSkillHandler({ taskStore, offering: LEAK_OFFERING, recipient: BOB });
    // No bound `from` and no invocation `from` → guard.
    await expect(handler({})).rejects.toBeInstanceOf(TypeError);
    // Invocation-time `from` wins.
    const { taskId } = await handler({ from: ANNE });
    expect((await taskStore.getById(taskId)).source.requestedBy).toBe(ANNE);
  });

  it('rejects a non-requestable contract (immediate/standing are not this factory)', () => {
    const taskStore = mkTaskStore();
    expect(() => requestableSkillHandler({
      taskStore, offering: LEAK_OFFERING, recipient: BOB, humanInTheLoop: 'never',
    })).toThrow(/required/);
  });
});

// ── 2. The task is acceptable by the recipient via the EXISTING lifecycle ────

describe('requestable task — accept via the ordinary lifecycle', () => {
  it('B accepts by claiming → assignee = recipient (claimed through taskStore.claim)', async () => {
    const taskStore = mkTaskStore();
    const handler = requestableSkillHandler({ taskStore, offering: LEAK_OFFERING, recipient: BOB, contextId: CIRCLE });
    const { taskId } = await handler({ from: ANNE });

    // Accept == the existing claim verb; the recipient becomes the assignee.
    const claimed = await taskStore.claim(taskId, { actor: BOB });
    expect(claimed.error).toBeUndefined();
    expect(claimed.assignee).toBe(BOB);
    expect(claimed.assignees).toEqual([BOB]);

    // Reflected on read-back.
    expect((await taskStore.getById(taskId)).assignee).toBe(BOB);
  });
});

// ── 3. offeringsToSkillDefinitions — projection + the non-requestable guard ──

describe('offeringsToSkillDefinitions — requestable offerings → skill defs (with guard)', () => {
  const offerings = [
    { key: 'skill',    text: 'fix leaks',   tags: ['plumbing'] },
    { key: 'gardening', text: 'trim hedges', tags: ['garden']  },
  ];

  it('projects ONLY requestable offerings into humanInTheLoop:required definitions; skips the rest', () => {
    // Anne marked only `skill` requestable in this circle; `gardening` is not.
    const policy = mkPolicy({ [CIRCLE]: { skill: { requestable: true } } });
    const taskStore = mkTaskStore();

    const defs = offeringsToSkillDefinitions({
      offerings, policy, contextId: CIRCLE, isRequestable, taskStore, recipient: BOB,
    });

    expect(defs.map((d) => d.id)).toEqual(['requestable:skill']);   // gardening absent — the GUARD
    const [def] = defs;
    expect(def.humanInTheLoop).toBe('required');
    expect(def.posture).toBe('negotiable');
    expect(typeof def.handler).toBe('function');
  });

  it('the produced handler, when invoked, mints the request-task (end-to-end through the def)', async () => {
    const policy = mkPolicy({ [CIRCLE]: { skill: { requestable: true } } });
    const taskStore = mkTaskStore();
    const [def] = offeringsToSkillDefinitions({
      offerings, policy, contextId: CIRCLE, isRequestable, taskStore, recipient: BOB,
    });

    const res = await def.handler({ from: ANNE });
    const task = await taskStore.getById(res.taskId);
    expect(task.kind).toBe(REQUEST_TASK_KIND);
    expect(task.source.requestedBy).toBe(ANNE);
    expect(task.source.forMember).toBe(BOB);
  });

  it('a NON-requestable offering produces NO handler at all (nothing to invoke)', () => {
    // Nothing marked requestable → empty projection → no handler exists for `skill`.
    const policy = mkPolicy({ [CIRCLE]: { skill: { requestable: false } } });
    const taskStore = mkTaskStore();
    const defs = offeringsToSkillDefinitions({
      offerings, policy, contextId: CIRCLE, isRequestable, taskStore, recipient: BOB,
    });
    expect(defs).toEqual([]);
  });

  it('requires the injected isRequestable predicate + a contextId', () => {
    const taskStore = mkTaskStore();
    expect(() => offeringsToSkillDefinitions({
      offerings, policy: {}, contextId: CIRCLE, taskStore, recipient: BOB,
    })).toThrow(/isRequestable/);
    expect(() => offeringsToSkillDefinitions({
      offerings, policy: {}, isRequestable, taskStore, recipient: BOB,
    })).toThrow(/contextId/);
  });
});

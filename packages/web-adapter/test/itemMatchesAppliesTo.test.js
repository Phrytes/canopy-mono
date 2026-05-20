/**
 * itemMatchesAppliesTo — unit tests.
 *
 * Mirrors `packages/app-manifest/test/renderChat.test.js`'s
 * appliesTo coverage where it overlaps (the web-side and chat-side
 * gates MUST agree — that's the platform-parity invariant).
 *
 * F-SP3-a — appliesTo.state may be a string OR an array.
 *
 * Synthetic fixtures only (no app deps).
 */
import { describe, it, expect } from 'vitest';

import { itemMatchesAppliesTo } from '../src/itemMatchesAppliesTo.js';

describe('itemMatchesAppliesTo — base predicates', () => {
  it('matches everything when appliesTo is undefined', () => {
    expect(itemMatchesAppliesTo(undefined, { id: 'x', type: 'task' })).toBe(true);
  });

  it('rejects when item is falsy and appliesTo is set', () => {
    expect(itemMatchesAppliesTo({ type: 'task' }, null)).toBe(false);
    expect(itemMatchesAppliesTo({ type: 'task' }, undefined)).toBe(false);
  });

  it('matches a single-string type gate', () => {
    expect(itemMatchesAppliesTo({ type: 'task' }, { type: 'task' })).toBe(true);
    expect(itemMatchesAppliesTo({ type: 'task' }, { type: 'shopping' })).toBe(false);
  });

  describe('Q8 wildcard — appliesTo.type === "*"', () => {
    it('wildcard matches every item.type', () => {
      expect(itemMatchesAppliesTo({ type: '*' }, { type: 'ask'   })).toBe(true);
      expect(itemMatchesAppliesTo({ type: '*' }, { type: 'offer' })).toBe(true);
      expect(itemMatchesAppliesTo({ type: '*' }, { type: 'lend'  })).toBe(true);
      expect(itemMatchesAppliesTo({ type: '*' }, { type: 'task'  })).toBe(true);
    });

    it('wildcard in array form matches every item.type', () => {
      // Less common but logically equivalent: appliesTo.type: ['*'].
      expect(itemMatchesAppliesTo({ type: ['*'] }, { type: 'ask' })).toBe(true);
    });

    it('wildcard + state gate — state still applies', () => {
      const gate = { type: '*', state: 'open' };
      // Open item — passes both.
      expect(itemMatchesAppliesTo(gate, { type: 'ask', state: 'open' })).toBe(true);
      // Wrong state — fails.
      expect(itemMatchesAppliesTo(gate, { type: 'ask', state: 'closed' })).toBe(false);
    });

    it('item with falsy type still rejected when appliesTo is set (existing invariant)', () => {
      expect(itemMatchesAppliesTo({ type: '*' }, null)).toBe(false);
    });
  });

  it('matches an array type gate', () => {
    const gate = { type: ['task', 'shopping'] };
    expect(itemMatchesAppliesTo(gate, { type: 'task' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { type: 'shopping' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { type: 'errand' })).toBe(false);
  });
});

describe('itemMatchesAppliesTo — state gates (F-SP3-a)', () => {
  it('matches a single-string state gate against item.state', () => {
    expect(itemMatchesAppliesTo({ state: 'open' }, { state: 'open' })).toBe(true);
    expect(itemMatchesAppliesTo({ state: 'open' }, { state: 'claimed' })).toBe(false);
  });

  it('matches a multi-state array gate against item.state', () => {
    const gate = { state: ['claimed', 'submitted', 'rejected'] }; // revokeTask
    expect(itemMatchesAppliesTo(gate, { state: 'claimed' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { state: 'submitted' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { state: 'rejected' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { state: 'open' })).toBe(false);
    expect(itemMatchesAppliesTo(gate, { state: 'complete' })).toBe(false);
  });

  it('derives state from substrate fields when item.state is missing', () => {
    // A completed item with no `state` field → derived state is 'complete'.
    const completed = { id: 'x', type: 'task', completedAt: 1 };
    expect(itemMatchesAppliesTo({ state: 'complete' }, completed)).toBe(true);
    expect(itemMatchesAppliesTo({ state: 'open' }, completed)).toBe(false);

    // A claimed task (assignee set, no completedAt) → derived 'claimed'.
    const claimed = { id: 'x', type: 'task', assignee: 'https://id.example/anne' };
    expect(itemMatchesAppliesTo({ state: 'claimed' }, claimed)).toBe(true);
    expect(itemMatchesAppliesTo({ state: 'open' }, claimed)).toBe(false);

    // A submitted task — state derived from reviewLog.
    const submitted = {
      id: 'x', type: 'task',
      assignee: 'https://id.example/anne',
      reviewLog: [{ decision: 'submit', by: 'https://id.example/anne', at: 1 }],
    };
    expect(itemMatchesAppliesTo({ state: ['claimed', 'submitted'] }, submitted)).toBe(true);
    expect(itemMatchesAppliesTo({ state: ['claimed'] }, submitted)).toBe(false);
  });
});

describe('itemMatchesAppliesTo — combined gates', () => {
  it('requires BOTH type AND state to match', () => {
    const gate = { type: 'task', state: ['claimed'] };
    expect(itemMatchesAppliesTo(gate, { type: 'task', state: 'claimed' })).toBe(true);
    expect(itemMatchesAppliesTo(gate, { type: 'task', state: 'open' })).toBe(false);
    expect(itemMatchesAppliesTo(gate, { type: 'shopping', state: 'claimed' })).toBe(false);
  });

  it('mirrors manifest revokeTask: revoke applies to claimed | submitted | rejected', () => {
    // The real-life tasksManifest gate from apps/tasks-v0/manifest.js.
    const revokeGate = { type: 'task', state: ['claimed', 'submitted', 'rejected'] };

    // Items in those states match.
    expect(itemMatchesAppliesTo(revokeGate, { type: 'task', state: 'claimed' })).toBe(true);
    expect(itemMatchesAppliesTo(revokeGate, { type: 'task', state: 'submitted' })).toBe(true);
    expect(itemMatchesAppliesTo(revokeGate, { type: 'task', state: 'rejected' })).toBe(true);

    // Items in other states don't.
    expect(itemMatchesAppliesTo(revokeGate, { type: 'task', state: 'open' })).toBe(false);
    expect(itemMatchesAppliesTo(revokeGate, { type: 'task', state: 'complete' })).toBe(false);
  });
});

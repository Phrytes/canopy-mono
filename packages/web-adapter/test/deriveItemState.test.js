/**
 * deriveItemState — unit tests.
 *
 * Verifies both the V0 lifecycle (open|complete|removed) used by
 * household lists AND the V0.7 DoD lifecycle (claimed|submitted|
 * rejected|complete|removed|open) used by tasks-v0 — the helper
 * subsumes both, per the B.2.0 brief.
 *
 * Synthetic fixtures only (no app deps).
 */
import { describe, it, expect } from 'vitest';

import { deriveItemState } from '../src/deriveItemState.js';

describe('deriveItemState — V0 lifecycle', () => {
  it('returns "open" for a fresh item', () => {
    expect(deriveItemState({ id: 'x', type: 'shopping', text: 'bread' })).toBe('open');
  });

  it('returns "complete" when completedAt is set', () => {
    expect(deriveItemState({ id: 'x', completedAt: 1700000000000 })).toBe('complete');
  });

  it('returns "removed" when removedAt is set (and completedAt is not)', () => {
    expect(deriveItemState({ id: 'x', removedAt: 1700000000000 })).toBe('removed');
  });

  it('falls back to "open" on falsy / non-object inputs', () => {
    expect(deriveItemState(null)).toBe('open');
    expect(deriveItemState(undefined)).toBe('open');
    expect(deriveItemState('not an item')).toBe('open');
  });
});

describe('deriveItemState — V0.7 DoD lifecycle (tasks)', () => {
  it('returns "claimed" when an assignee is set but no reviewLog', () => {
    expect(deriveItemState({
      id: 'x', type: 'task', assignee: 'https://id.example/anne',
    })).toBe('claimed');
  });

  it('returns "submitted" when reviewLog\'s last decision is submit', () => {
    expect(deriveItemState({
      id: 'x', type: 'task',
      assignee: 'https://id.example/anne',
      reviewLog: [{ decision: 'submit', by: 'https://id.example/anne', at: 1 }],
    })).toBe('submitted');
  });

  it('returns "rejected" when reviewLog\'s last decision is reject', () => {
    expect(deriveItemState({
      id: 'x', type: 'task',
      assignee: 'https://id.example/anne',
      reviewLog: [
        { decision: 'submit', by: 'https://id.example/anne', at: 1 },
        { decision: 'reject', by: 'https://id.example/frits', at: 2, note: 'try again' },
      ],
    })).toBe('rejected');
  });

  it('the LAST reviewLog entry wins (post-rejection re-submit lands at submitted)', () => {
    expect(deriveItemState({
      id: 'x', type: 'task',
      assignee: 'https://id.example/anne',
      reviewLog: [
        { decision: 'submit', by: 'https://id.example/anne', at: 1 },
        { decision: 'reject', by: 'https://id.example/frits', at: 2, note: 'fix' },
        { decision: 'submit', by: 'https://id.example/anne', at: 3 },
      ],
    })).toBe('submitted');
  });

  it('completedAt dominates reviewLog (a closed task is closed)', () => {
    expect(deriveItemState({
      id: 'x', type: 'task',
      completedAt: 100,
      assignee: 'https://id.example/anne',
      reviewLog: [{ decision: 'submit', by: 'https://id.example/anne', at: 1 }],
    })).toBe('complete');
  });
});

describe('deriveItemState — substrate-stamped status pass-through', () => {
  it('honours an explicit item.status of "ready"', () => {
    expect(deriveItemState({ id: 'x', type: 'task', status: 'ready' })).toBe('ready');
  });

  it('honours "waiting" (DAG-blocked but ready when deps resolve)', () => {
    expect(deriveItemState({ id: 'x', type: 'task', status: 'waiting' })).toBe('waiting');
  });

  it('honours "blocked"', () => {
    expect(deriveItemState({ id: 'x', type: 'task', status: 'blocked' })).toBe('blocked');
  });

  it('honours "claimed" / "submitted" / "rejected" / "complete"', () => {
    for (const s of ['claimed', 'submitted', 'rejected', 'complete']) {
      expect(deriveItemState({ id: 'x', type: 'task', status: s })).toBe(s);
    }
  });

  it('rejects an unknown status string and falls back to lifecycle derivation', () => {
    // Unknown enum → falls back to the field-based derivation. A bare
    // item with no reviewLog/assignee/completedAt → 'open'.
    expect(deriveItemState({ id: 'x', type: 'task', status: 'lolwut' })).toBe('open');
  });
});

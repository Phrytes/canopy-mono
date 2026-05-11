/**
 * dag — DAG helpers lifted from apps/tasks-v0/src/dag.js (Phase 52.6.2).
 *
 * Behavioural parity with the original tasks-v0 module.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDagStatus,
  effectiveStatus,
  unmetDeps,
  detectCycle,
} from '../src/dag.js';

const item = (id, extras = {}) => ({ id, ...extras });

describe('computeDagStatus', () => {
  it('no dependencies → ready', () => {
    expect(computeDagStatus({}, [], [])).toBe('ready');
    expect(computeDagStatus({ dependencies: [] }, [], [])).toBe('ready');
  });

  it('all deps closed → ready', () => {
    expect(computeDagStatus(
      { dependencies: ['a', 'b'] },
      [],
      [item('a'), item('b')],
    )).toBe('ready');
  });

  it('some deps open → waiting', () => {
    expect(computeDagStatus(
      { dependencies: ['a', 'b'] },
      [item('a')],
      [item('b')],
    )).toBe('waiting');
  });

  it('dep neither open nor closed → blocked', () => {
    expect(computeDagStatus(
      { dependencies: ['ghost'] },
      [],
      [],
    )).toBe('blocked');
  });
});

describe('effectiveStatus', () => {
  it('completedAt wins over everything', () => {
    expect(effectiveStatus(
      { completedAt: 123, dependencies: ['x'], assignee: 'a' },
      [],
      [],
    )).toBe('complete');
  });

  it('reviewLog[submit] → submitted', () => {
    expect(effectiveStatus(
      { reviewLog: [{ decision: 'submit' }] },
      [], [],
    )).toBe('submitted');
  });

  it('reviewLog[reject] → rejected', () => {
    expect(effectiveStatus(
      { reviewLog: [{ decision: 'reject' }] },
      [], [],
    )).toBe('rejected');
  });

  it('assignee set → claimed (even when deps blocked)', () => {
    expect(effectiveStatus(
      { assignee: 'anne', dependencies: ['ghost'] },
      [], [],
    )).toBe('claimed');
  });

  it('falls back to DAG status', () => {
    expect(effectiveStatus({ dependencies: [] }, [], [])).toBe('ready');
    expect(effectiveStatus(
      { dependencies: ['a'] }, [item('a')], [],
    )).toBe('waiting');
  });

  it('null input → ready', () => {
    expect(effectiveStatus(null, [], [])).toBe('ready');
  });
});

describe('unmetDeps', () => {
  it('returns IDs not in closedItems', () => {
    expect(unmetDeps(
      { dependencies: ['a', 'b', 'c'] },
      [item('a')],
      [item('b')],
    )).toEqual(['a', 'c']);
  });

  it('empty when no deps', () => {
    expect(unmetDeps({}, [], [])).toEqual([]);
  });

  it('empty when all deps satisfied', () => {
    expect(unmetDeps(
      { dependencies: ['a'] },
      [],
      [item('a')],
    )).toEqual([]);
  });
});

describe('detectCycle', () => {
  it('returns null when no cycle', () => {
    const tasks = [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['c'] },
      { id: 'c' },
    ];
    expect(detectCycle(tasks[0], tasks)).toBe(null);
  });

  it('detects direct cycle a → b → a', () => {
    const tasks = [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ];
    const cycle = detectCycle(tasks[0], tasks);
    expect(cycle).toEqual(['a', 'b', 'a']);
  });

  it('detects self-cycle', () => {
    const t = { id: 'a', dependencies: ['a'] };
    const cycle = detectCycle(t, [t]);
    expect(cycle).toEqual(['a', 'a']);
  });

  it('null when task has no dependencies', () => {
    expect(detectCycle({ id: 'a' }, [])).toBe(null);
  });
});

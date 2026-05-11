/**
 * inboxClassify — pure-fn coverage for kindOf + proposalIdOf.
 *
 * Phase 41.6.7 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { kindOf, proposalIdOf, requestIdOf } from '../../src/ui/inboxClassify.js';

describe('kindOf', () => {
  it('classifies subtask-proposal events', () => {
    expect(kindOf({ kind: 'subtask-proposal' })).toBe('subtask-proposal');
    expect(kindOf({ eventKind: 'subtask-proposal' })).toBe('subtask-proposal');
  });
  it('classifies V1 subtask-request events', () => {
    expect(kindOf({ kind: 'subtask-request' })).toBe('subtask-request');
  });
  it('classifies known task events', () => {
    expect(kindOf({ kind: 'task-rejected' })).toBe('task-rejected');
    expect(kindOf({ kind: 'task-claimed' })).toBe('task-claimed');
    expect(kindOf({ kind: 'task-completed' })).toBe('task-completed');
  });
  it('falls through to unknown', () => {
    expect(kindOf(null)).toBe('unknown');
    expect(kindOf({})).toBe('unknown');
    expect(kindOf({ kind: 'mystery' })).toBe('unknown');
  });
});

describe('proposalIdOf', () => {
  it('prefers proposalId, falls back to id', () => {
    expect(proposalIdOf({ proposalId: 'p1', id: 'i1' })).toBe('p1');
    expect(proposalIdOf({ id: 'i1' })).toBe('i1');
  });
  it('returns null for empty/missing inputs', () => {
    expect(proposalIdOf(null)).toBeNull();
    expect(proposalIdOf({})).toBeNull();
    expect(proposalIdOf({ proposalId: '' })).toBeNull();
  });
});

describe('requestIdOf', () => {
  it('prefers requestId, falls back to id', () => {
    expect(requestIdOf({ requestId: 'r1', id: 'i1' })).toBe('r1');
    expect(requestIdOf({ id: 'i1' })).toBe('i1');
  });
  it('returns null for empty/missing inputs', () => {
    expect(requestIdOf(null)).toBeNull();
    expect(requestIdOf({})).toBeNull();
    expect(requestIdOf({ requestId: '' })).toBeNull();
  });
});

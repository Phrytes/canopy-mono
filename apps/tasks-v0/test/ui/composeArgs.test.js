/**
 * composeArgs unit tests — exercise the addTask + forceSpawnSubtask
 * payload builders so the screens can stay thin.
 *
 * Phase 41.18.1 (2026-05-10).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAddTaskArgs,
  buildAddSubtaskArgs,
  buildForceSpawnArgs,
  parseDueAt,
  normaliseSkills,
  normaliseDeps,
} from '../../src/ui/composeArgs.js';

describe('composeArgs.parseDueAt', () => {
  it('parses YYYY-MM-DD → epoch-ms (UTC)', () => {
    const ms = parseDueAt('2026-12-31');
    expect(typeof ms).toBe('number');
    const d = new Date(ms);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCDate()).toBe(31);
  });
  it('returns null for empty / non-matching / non-string', () => {
    expect(parseDueAt('')).toBeNull();
    expect(parseDueAt('   ')).toBeNull();
    expect(parseDueAt('not-a-date')).toBeNull();
    expect(parseDueAt('2026/12/31')).toBeNull();
    expect(parseDueAt(null)).toBeNull();
    expect(parseDueAt(undefined)).toBeNull();
  });
});

describe('composeArgs.normaliseSkills', () => {
  it('splits comma-separated strings + trims + drops empties', () => {
    expect(normaliseSkills('plumbing, carpentry,  ')).toEqual(['plumbing', 'carpentry']);
  });
  it('accepts arrays', () => {
    expect(normaliseSkills(['a', '', 'b '])).toEqual(['a', 'b']);
  });
  it('returns [] for null/undefined/empty/non-string', () => {
    expect(normaliseSkills(null)).toEqual([]);
    expect(normaliseSkills(undefined)).toEqual([]);
    expect(normaliseSkills('')).toEqual([]);
    expect(normaliseSkills(42)).toEqual([]);
  });
});

describe('composeArgs.normaliseDeps', () => {
  it('drops non-strings, trims, dedupes', () => {
    expect(normaliseDeps(['a', null, 'b ', 'a'])).toEqual(['a', 'b']);
  });
  it('returns [] for non-array input', () => {
    expect(normaliseDeps(null)).toEqual([]);
    expect(normaliseDeps('a')).toEqual([]);
  });
});

describe('composeArgs.buildAddTaskArgs', () => {
  it('builds a minimal payload for text-only DoD', () => {
    const out = buildAddTaskArgs({ text: 'fix the faucet' });
    expect(out.text).toBe('fix the faucet');
    expect(out.definitionOfDone).toEqual({ kind: 'text' });
    expect(out.dueAt).toBeUndefined();
    expect(out.requiredSkills).toBeUndefined();
    expect(out.dependencies).toBeUndefined();
    expect(out.master).toBeUndefined();
    expect(out.approval).toBeUndefined();
    expect(out.parentTaskId).toBeUndefined();
  });

  it('includes dueAt + requiredSkills when provided', () => {
    const out = buildAddTaskArgs({
      text:           'install dishwasher',
      dueAt:          '2026-12-31',
      requiredSkills: 'plumbing, electrics',
      dod:            'photo',
    });
    expect(out.dueAt).toBe(Date.UTC(2026, 11, 31));
    expect(out.requiredSkills).toEqual(['plumbing', 'electrics']);
    expect(out.definitionOfDone).toEqual({ kind: 'photo' });
  });

  it('includes dependencies + master + approvalMode + parentTaskId', () => {
    const out = buildAddTaskArgs({
      text:         'paint the fence',
      dependencies: ['t-1', 't-2', 't-1'],   // dedupes
      master:       'webid://alice',
      approvalMode: 'dual-approval',
      parentTaskId: 'parent-id',
    });
    expect(out.dependencies).toEqual(['t-1', 't-2']);
    expect(out.master).toBe('webid://alice');
    expect(out.approval).toBe('dual-approval');
    expect(out.parentTaskId).toBe('parent-id');
  });

  it('throws when text is missing/blank', () => {
    expect(() => buildAddTaskArgs({})).toThrow(/text is required/);
    expect(() => buildAddTaskArgs({ text: '   ' })).toThrow(/text is required/);
  });

  it('ignores invalid approvalMode values', () => {
    const out = buildAddTaskArgs({ text: 'x', approvalMode: 'nope' });
    expect(out.approval).toBeUndefined();
  });
});

describe('composeArgs.buildForceSpawnArgs', () => {
  it('builds the force-spawn payload with parentTaskId + reason', () => {
    const out = buildForceSpawnArgs({
      text:         'unblock parent',
      parentTaskId: 'parent-id',
      reason:       'parent is overdue and assignee is on holiday',
    });
    expect(out.text).toBe('unblock parent');
    expect(out.parentTaskId).toBe('parent-id');
    expect(out.reason).toMatch(/holiday/);
    expect(out.definitionOfDone).toEqual({ kind: 'text' });
  });

  it('throws when text/parentTaskId/reason are blank', () => {
    expect(() => buildForceSpawnArgs({ parentTaskId: 'p', reason: 'r' })).toThrow(/text/);
    expect(() => buildForceSpawnArgs({ text: 't', reason: 'r' })).toThrow(/parentTaskId/);
    expect(() => buildForceSpawnArgs({ text: 't', parentTaskId: 'p' })).toThrow(/reason/);
  });

  it('forwards optional fields when set', () => {
    const out = buildForceSpawnArgs({
      text:           'sub',
      parentTaskId:   'p',
      reason:         'because',
      requiredSkills: ['a'],
      master:         'webid://x',
      approvalMode:   'approval',
    });
    expect(out.requiredSkills).toEqual(['a']);
    expect(out.master).toBe('webid://x');
    expect(out.approval).toBe('approval');
  });
});

describe('composeArgs.buildAddSubtaskArgs', () => {
  it('builds a minimal sub-task payload', () => {
    const out = buildAddSubtaskArgs({
      text: 'paint trim',
      parentTaskId: 'parent-id',
    });
    expect(out.text).toBe('paint trim');
    expect(out.parentTaskId).toBe('parent-id');
    expect(out.definitionOfDone).toEqual({ kind: 'text' });
  });

  it('throws when text or parentTaskId are blank', () => {
    expect(() => buildAddSubtaskArgs({ parentTaskId: 'p' })).toThrow(/text/);
    expect(() => buildAddSubtaskArgs({ text: 't' })).toThrow(/parentTaskId/);
    expect(() => buildAddSubtaskArgs({ text: ' ', parentTaskId: 'p' })).toThrow(/text/);
  });

  it('forwards dueAt + requiredSkills + master + approvalMode', () => {
    const out = buildAddSubtaskArgs({
      text: 'sub',
      parentTaskId: 'p',
      dueAt: '2026-12-31',
      requiredSkills: 'plumbing',
      master: 'webid://anne',
      approvalMode: 'approval',
    });
    expect(out.dueAt).toBe(Date.UTC(2026, 11, 31));
    expect(out.requiredSkills).toEqual(['plumbing']);
    expect(out.master).toBe('webid://anne');
    expect(out.approval).toBe('approval');
  });

  it('drops `dependencies` — substrate auto-wires parent.deps', () => {
    // Phase 41.18 follow-up — sub-tasks must NOT carry their own
    // dependencies in the addSubtask payload. The substrate wires
    // parent.dependencies[] += [subId] on its own; passing
    // child-deps here would silently desync the hard-deps gate.
    const out = buildAddSubtaskArgs({
      text: 'sub',
      parentTaskId: 'p',
      dependencies: ['t-1', 't-2'],
    });
    expect(out.dependencies).toBeUndefined();
  });

  it('honours photo DoD', () => {
    const out = buildAddSubtaskArgs({
      text: 'sub', parentTaskId: 'p', dod: 'photo',
    });
    expect(out.definitionOfDone).toEqual({ kind: 'photo' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CIRCLE_POLICY, CIRCLE_FEATURES,
  normalizeCirclePolicy, mergeCirclePolicy,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
} from '../../src/v2/circlePolicy.js';

describe('circlePolicy · normalizeCirclePolicy', () => {
  it('fills defaults for an empty/garbage input', () => {
    expect(normalizeCirclePolicy()).toEqual(DEFAULT_CIRCLE_POLICY);
    expect(normalizeCirclePolicy(null)).toEqual(DEFAULT_CIRCLE_POLICY);
    expect(normalizeCirclePolicy('nope')).toEqual(DEFAULT_CIRCLE_POLICY);
  });

  it('keeps valid enum values and rejects invalid ones', () => {
    const p = normalizeCirclePolicy({ llmTool: 'local', pod: 'shared', agents: 'bogus' });
    expect(p.llmTool).toBe('local');
    expect(p.pod).toBe('shared');
    expect(p.agents).toBe('admin-approval'); // invalid → default
  });

  it('merges features per-key and ignores non-boolean / unknown features', () => {
    const p = normalizeCirclePolicy({ features: { noticeboard: true, chat: 'yes', bogus: true } });
    expect(p.features.noticeboard).toBe(true);
    expect(p.features.chat).toBe(true); // non-boolean → default (true)
    expect(Object.keys(p.features).sort()).toEqual([...CIRCLE_FEATURES].sort());
    expect(p.features.bogus).toBeUndefined();
  });

  it('keeps only string admins', () => {
    expect(normalizeCirclePolicy({ admins: ['a', 2, null, 'b'] }).admins).toEqual(['a', 'b']);
  });
});

describe('circlePolicy · mergeCirclePolicy', () => {
  it('applies a patch over a base without dropping other features', () => {
    const base = normalizeCirclePolicy({ features: { noticeboard: true }, pod: 'shared' });
    const next = mergeCirclePolicy(base, { features: { tasks: true }, llmTool: 'cloud' });
    expect(next.features.noticeboard).toBe(true); // preserved
    expect(next.features.tasks).toBe(true);       // added
    expect(next.pod).toBe('shared');              // preserved
    expect(next.llmTool).toBe('cloud');           // changed
  });
});

describe('memberOverride', () => {
  it('normalises defaults + coerces booleans', () => {
    expect(normalizeMemberOverride()).toEqual(DEFAULT_MEMBER_OVERRIDE);
    const o = normalizeMemberOverride({ chatOff: 1, agentsMayContactMe: false, flowThrough: { tasksToPersonal: 'y' } });
    expect(o.chatOff).toBe(true);
    expect(o.agentsMayContactMe).toBe(false);
    expect(o.flowThrough.tasksToPersonal).toBe(true);
    expect(o.flowThrough.calendarToPersonal).toBe(false);
  });

  it('deep-merges flowThrough on edit', () => {
    const base = normalizeMemberOverride({ flowThrough: { tasksToPersonal: true } });
    const next = mergeMemberOverride(base, { flowThrough: { calendarToPersonal: true } });
    expect(next.flowThrough).toEqual({ tasksToPersonal: true, calendarToPersonal: true });
  });
});

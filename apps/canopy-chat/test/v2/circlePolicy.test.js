import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CIRCLE_POLICY, CIRCLE_FEATURES,
  normalizeCirclePolicy, mergeCirclePolicy,
  isFeatureEnabled, enabledFeatures,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
  shouldPushNotify,
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

describe('circlePolicy · isFeatureEnabled (P6.1)', () => {
  it('returns the default for null / undefined / non-object policy', () => {
    expect(isFeatureEnabled(null,      'chat')).toBe(true);   // default on
    expect(isFeatureEnabled(undefined, 'tasks')).toBe(false); // default off
    expect(isFeatureEnabled('garbage', 'houseRules')).toBe(true);
    expect(isFeatureEnabled(42,        'memberDirectory')).toBe(true);
  });

  it('returns the default when policy has no .features field', () => {
    expect(isFeatureEnabled({}, 'chat')).toBe(true);
    expect(isFeatureEnabled({ view: 'chat' }, 'tasks')).toBe(false);
    expect(isFeatureEnabled({ features: null }, 'houseRules')).toBe(true);
  });

  it('returns the explicit flag when set', () => {
    const off = { features: { chat: false, houseRules: false } };
    expect(isFeatureEnabled(off, 'chat')).toBe(false);
    expect(isFeatureEnabled(off, 'houseRules')).toBe(false);
    // unset → default
    expect(isFeatureEnabled(off, 'memberDirectory')).toBe(true);
  });

  it('rejects unknown feature keys', () => {
    expect(isFeatureEnabled({ features: { bogus: true } }, 'bogus')).toBe(false);
    expect(isFeatureEnabled(DEFAULT_CIRCLE_POLICY,         'bogus')).toBe(false);
  });

  it('treats non-boolean flag values as the default', () => {
    const garbage = { features: { chat: 'yes', tasks: 1 } };
    expect(isFeatureEnabled(garbage, 'chat')).toBe(true);   // default on
    expect(isFeatureEnabled(garbage, 'tasks')).toBe(false); // default off
  });
});

describe('circlePolicy · enabledFeatures (P6.1)', () => {
  it('returns the default-enabled set for a null/empty policy', () => {
    // Defaults: chat, houseRules, memberDirectory.
    expect(enabledFeatures(null)).toEqual(['chat', 'houseRules', 'memberDirectory']);
    expect(enabledFeatures({})).toEqual(['chat', 'houseRules', 'memberDirectory']);
  });

  it('respects explicit on/off overrides + preserves CIRCLE_FEATURES order', () => {
    const p = { features: {
      chat: false, noticeboard: true, tasks: true,
      houseRules: false, memberDirectory: true,
    } };
    expect(enabledFeatures(p)).toEqual(['noticeboard', 'tasks', 'memberDirectory']);
  });

  it('the full-on circle enables every CIRCLE_FEATURES key', () => {
    const allOn = { features: Object.fromEntries(CIRCLE_FEATURES.map((k) => [k, true])) };
    expect(enabledFeatures(allOn)).toEqual([...CIRCLE_FEATURES]);
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

  // P6.M4 — split push toggles.
  it('defaults push to {onMention: true, onEveryMessage: false} (board 6A)', () => {
    expect(DEFAULT_MEMBER_OVERRIDE.push).toEqual({ onMention: true, onEveryMessage: false });
    expect(normalizeMemberOverride({}).push).toEqual({ onMention: true, onEveryMessage: false });
  });

  it('coerces push keys to booleans + preserves explicit values', () => {
    const o = normalizeMemberOverride({ push: { onMention: false, onEveryMessage: 'y' /* non-bool */ } });
    expect(o.push.onMention).toBe(false);
    expect(o.push.onEveryMessage).toBe(false);
    const o2 = normalizeMemberOverride({ push: { onEveryMessage: true } });
    expect(o2.push).toEqual({ onMention: true, onEveryMessage: true });
  });

  it('deep-merges push on edit', () => {
    const base = normalizeMemberOverride({ push: { onMention: true, onEveryMessage: false } });
    const next = mergeMemberOverride(base, { push: { onEveryMessage: true } });
    expect(next.push).toEqual({ onMention: true, onEveryMessage: true });
  });
});

describe('shouldPushNotify (P6.M4)', () => {
  it('returns push.onMention for kind=mention', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'mention')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: false, onEveryMessage: false } }, 'mention')).toBe(false);
  });

  it('returns push.onEveryMessage for kind=message', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: true  } }, 'message')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'message')).toBe(false);
  });

  it('uses the defaults when override is empty', () => {
    expect(shouldPushNotify({}, 'mention')).toBe(true);
    expect(shouldPushNotify({}, 'message')).toBe(false);
  });

  it('returns false for unknown kinds', () => {
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE, 'bogus')).toBe(false);
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE)).toBe(false);
  });
});

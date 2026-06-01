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

describe('circlePolicy · ε.6 catchUpChooserMode', () => {
  it("defaults to 'auto'", () => {
    expect(DEFAULT_CIRCLE_POLICY.catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy().catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({}).catchUpChooserMode).toBe('auto');
  });

  it("round-trips 'prompt'", () => {
    const p = normalizeCirclePolicy({ catchUpChooserMode: 'prompt' });
    expect(p.catchUpChooserMode).toBe('prompt');
    // idempotent
    expect(normalizeCirclePolicy(p).catchUpChooserMode).toBe('prompt');
  });

  it("invalid value falls back to 'auto'", () => {
    expect(normalizeCirclePolicy({ catchUpChooserMode: 'bogus' }).catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({ catchUpChooserMode: 42 }).catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({ catchUpChooserMode: null }).catchUpChooserMode).toBe('auto');
  });

  it('merges through mergeCirclePolicy without disturbing other axes', () => {
    const base = normalizeCirclePolicy({ pod: 'shared', llmTool: 'local' });
    const next = mergeCirclePolicy(base, { catchUpChooserMode: 'prompt' });
    expect(next.catchUpChooserMode).toBe('prompt');
    expect(next.pod).toBe('shared');
    expect(next.llmTool).toBe('local');
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

  // P6.M4 + α.5b — split push toggles (four kinds).
  it('defaults push to the four-kind shape (board 6A · α.5b)', () => {
    expect(DEFAULT_MEMBER_OVERRIDE.push).toEqual({
      onMention:      true,
      onEveryMessage: false,
      onNewItem:      true,
      onProposal:     true,
    });
    expect(normalizeMemberOverride({}).push).toEqual({
      onMention:      true,
      onEveryMessage: false,
      onNewItem:      true,
      onProposal:     true,
    });
  });

  it('coerces push keys to booleans + preserves explicit values', () => {
    const o = normalizeMemberOverride({ push: { onMention: false, onEveryMessage: 'y' /* non-bool */ } });
    expect(o.push.onMention).toBe(false);
    expect(o.push.onEveryMessage).toBe(false);
    // unspecified keys keep their defaults (newItem/proposal default true)
    expect(o.push.onNewItem).toBe(true);
    expect(o.push.onProposal).toBe(true);
    const o2 = normalizeMemberOverride({ push: { onEveryMessage: true, onNewItem: false, onProposal: false } });
    expect(o2.push).toEqual({
      onMention:      true,
      onEveryMessage: true,
      onNewItem:      false,
      onProposal:     false,
    });
  });

  it('deep-merges push on edit', () => {
    const base = normalizeMemberOverride({ push: { onMention: true, onEveryMessage: false } });
    const next = mergeMemberOverride(base, { push: { onEveryMessage: true, onProposal: false } });
    expect(next.push).toEqual({
      onMention:      true,
      onEveryMessage: true,
      onNewItem:      true,    // preserved default
      onProposal:     false,   // patched
    });
  });

  it('α.5b — round-trips a stored doc with the four push keys', () => {
    const stored = {
      chatOff: true,
      revealOpen: false,
      agentsMayContactMe: false,
      push: { onMention: false, onEveryMessage: true, onNewItem: false, onProposal: true },
      flowThrough: { tasksToPersonal: true, calendarToPersonal: false },
    };
    const round = normalizeMemberOverride(stored);
    expect(round.push).toEqual({
      onMention: false, onEveryMessage: true, onNewItem: false, onProposal: true,
    });
    // a second pass is stable (idempotent)
    expect(normalizeMemberOverride(round)).toEqual(round);
  });
});

describe('shouldPushNotify (P6.M4 + α.5b)', () => {
  it('returns push.onMention for kind=mention', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'mention')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: false, onEveryMessage: false } }, 'mention')).toBe(false);
  });

  it('returns push.onEveryMessage for kind=message', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: true  } }, 'message')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'message')).toBe(false);
  });

  it('α.5b — returns push.onNewItem for kind=newItem', () => {
    expect(shouldPushNotify({ push: { onNewItem: true  } }, 'newItem')).toBe(true);
    expect(shouldPushNotify({ push: { onNewItem: false } }, 'newItem')).toBe(false);
  });

  it('α.5b — returns push.onProposal for kind=proposal', () => {
    expect(shouldPushNotify({ push: { onProposal: true  } }, 'proposal')).toBe(true);
    expect(shouldPushNotify({ push: { onProposal: false } }, 'proposal')).toBe(false);
  });

  it('uses the defaults when override is empty', () => {
    expect(shouldPushNotify({}, 'mention')).toBe(true);
    expect(shouldPushNotify({}, 'message')).toBe(false);
    expect(shouldPushNotify({}, 'newItem')).toBe(true);
    expect(shouldPushNotify({}, 'proposal')).toBe(true);
  });

  it('returns false for unknown kinds (α.5b — new kinds stay silent until wired)', () => {
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE, 'bogus')).toBe(false);
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE)).toBe(false);
  });
});

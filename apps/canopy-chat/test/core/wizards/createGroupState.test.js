/**
 * canopy-chat — createGroupState wire-up tests for β.4 (kind-aware
 * "+ new circle" templates).  Verifies that `setKind` consumes the
 * `kringTemplates` substrate to fill policy axes in the wizard state
 * and respects user-set overrides.
 */
import { describe, it, expect } from 'vitest';
import {
  initialState, setKind, KRING_KINDS,
} from '../../../src/core/wizards/createGroupState.js';
import { KRING_TEMPLATES } from '../../../src/v2/kringTemplates.js';

describe('initialState', () => {
  it('starts with kind=null + no policy axes set', () => {
    const s = initialState();
    expect(s.kind).toBe(null);
    expect(s.features).toBeUndefined();
    expect(s.revealPolicy).toBeUndefined();
    expect(s.pod).toBeUndefined();
    expect(s.llmTool).toBeUndefined();
    expect(s.agents).toBeUndefined();
    // consensusRequired is also unset until a kind picks (or the user
    // toggles it explicitly).  Identity / governance defaults remain.
    expect(s.consensusRequired).toBeUndefined();
    expect(s.accessPolicy).toBe('invite-only');
  });
});

describe('setKind — fills policy axes from the template', () => {
  it('picking household fills features + all policy axes', () => {
    const s0 = initialState();
    const s1 = setKind(s0, 'household');
    expect(s1.kind).toBe('household');
    expect(s1.features).toEqual(KRING_TEMPLATES.household.features);
    expect(s1.revealPolicy).toBe('open');
    expect(s1.pod).toBe('shared');
    expect(s1.llmTool).toBe('local');
    expect(s1.agents).toBe('admin-approval');
    expect(s1.consensusRequired).toBe(false);
    // Identity fields untouched.
    expect(s1.name).toBe('');
    expect(s1.accessPolicy).toBe('invite-only');
  });

  it('picking buurt fills the buurt template', () => {
    const s = setKind(initialState(), 'buurt');
    expect(s.kind).toBe('buurt');
    expect(s.features.noticeboard).toBe(true);
    expect(s.features.calendar).toBe(false);
    expect(s.revealPolicy).toBe('pairwise');
    expect(s.pod).toBe('personal');
    expect(s.consensusRequired).toBe(true);
  });

  it('picking an unknown kind falls back to _default', () => {
    const s = setKind(initialState(), 'unknownStyle');
    expect(s.kind).toBe('unknownStyle');
    expect(s.revealPolicy).toBe(KRING_TEMPLATES._default.revealPolicy);
    expect(s.pod).toBe(KRING_TEMPLATES._default.pod);
    expect(s.llmTool).toBe(KRING_TEMPLATES._default.llmTool);
  });

  it('does not mutate the input state', () => {
    const s0 = initialState();
    const before = { ...s0 };
    setKind(s0, 'household');
    expect(s0).toEqual(before);
  });
});

describe('setKind — preserves explicit user choices', () => {
  it('a feature the user toggled before picking is not clobbered', () => {
    const s0 = { ...initialState(), features: { chat: false } };
    const s1 = setKind(s0, 'household');
    // user-toggled chat:false survives
    expect(s1.features.chat).toBe(false);
    // other features still fill from the template
    expect(s1.features.noticeboard).toBe(true);
    expect(s1.features.tasks).toBe(true);
  });

  it('a user-set revealPolicy / pod / llmTool / agents survives a kind pick', () => {
    const s0 = {
      ...initialState(),
      revealPolicy: 'pairwise',
      pod:          'none',
      llmTool:      'cloud',
      agents:       'no',
      consensusRequired: true,
    };
    const s1 = setKind(s0, 'household');
    // template defaults differ; user values win on every axis.
    expect(s1.revealPolicy).toBe('pairwise');
    expect(s1.pod).toBe('none');
    expect(s1.llmTool).toBe('cloud');
    expect(s1.agents).toBe('no');
    expect(s1.consensusRequired).toBe(true);
  });

  it('switching kinds is a no-op for axes the previous pick already filled', () => {
    // Design call (kringTemplates.js header): never overwrite a value
    // already on the state, even one supplied by a previous template.
    const s1 = setKind(initialState(), 'household');
    const s2 = setKind(s1, 'buurt');
    expect(s2.kind).toBe('buurt');
    // axes from household preserved
    expect(s2.revealPolicy).toBe(s1.revealPolicy);
    expect(s2.pod).toBe(s1.pod);
    expect(s2.llmTool).toBe(s1.llmTool);
    expect(s2.agents).toBe(s1.agents);
    expect(s2.consensusRequired).toBe(s1.consensusRequired);
    // features map likewise preserved
    expect(s2.features).toEqual(s1.features);
  });
});

describe('KRING_KINDS — re-exported from createGroupState', () => {
  it('exposes the four canonical kinds', () => {
    expect(KRING_KINDS.slice().sort()).toEqual(
      ['buurt', 'household', 'team', 'vriendenkring'],
    );
  });
});

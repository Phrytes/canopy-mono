/**
 * createReactBindings — focused smoke. The full hook behaviour is
 * exercised end-to-end by each consumer's ServiceContext test
 * (the substrate's only obligation is "factory arg validation +
 * the returned hooks are functions").
 */

import { describe, it, expect } from 'vitest';
import { createReactBindings } from '../../src/react/createReactBindings.js';

describe('@canopy/sync-engine-rn/react createReactBindings', () => {
  it('throws when useService is not a function', () => {
    expect(() => createReactBindings({})).toThrow(/useService hook required/);
    expect(() => createReactBindings({ useService: null })).toThrow(/useService hook required/);
    expect(() => createReactBindings()).toThrow(/useService hook required/);
  });

  it('returns the three hook functions when wired correctly', () => {
    const bindings = createReactBindings({ useService: () => ({}) });
    expect(typeof bindings.useSkill).toBe('function');
    expect(typeof bindings.useAgentEvent).toBe('function');
    expect(typeof bindings.useSkillResult).toBe('function');
  });
});

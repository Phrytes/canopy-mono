// NAMESPACE guard — the charter `role` (`charter:role`) is a plain DISCLOSED
// coarse attribute and must never drift into the rank-bearing GOVERNANCE role
// (admin/coordinator/member, packages/core/src/permissions/Roles.js). These
// assertions fail if someone gives the charter role rank/authority semantics or
// lets its buckets collide with governance ranks.
// See plans/PLAN-capabilities-tasks-roles.md Phase 0.
import { describe, it, expect } from 'vitest';
import {
  VOCABULARY,
  CHARTER_ROLE_KEY,
  isVocabKey,
  bucketsFor,
  isValidValue,
} from '../src/vocabulary.js';

// The governance ranks that carry authority — the charter role must share NONE
// of them. Hardcoded (not imported) to keep attribute-charter free of a core
// dependency; this list mirrors core/permissions/Roles.js STANDARD_RANKS names.
const GOVERNANCE_RANKS = ['admin', 'coordinator', 'member', 'owner', 'moderator'];

describe('charter:role is a plain disclosed attribute (not a governance role)', () => {
  it('is exposed via the disambiguated CHARTER_ROLE_KEY constant', () => {
    expect(CHARTER_ROLE_KEY).toBe('role');
    expect(isVocabKey(CHARTER_ROLE_KEY)).toBe(true);
  });

  it('is a closed coarse-enum with exactly the who-are-you-here buckets', () => {
    expect(bucketsFor(CHARTER_ROLE_KEY)).toEqual([
      'resident', 'works-here', 'visitor', 'business-owner',
    ]);
    // A disclosed background label — accepts a bucket value, rejects anything else.
    expect(isValidValue(CHARTER_ROLE_KEY, 'resident')).toBe(true);
    expect(isValidValue(CHARTER_ROLE_KEY, 'admin')).toBe(false);
  });

  it('carries NO rank / authority / grant semantics', () => {
    const entry = VOCABULARY[CHARTER_ROLE_KEY];
    // The vocabulary entry is a pure {buckets, never} shape — no field that could
    // confer standing. If a build adds one of these, this fails on purpose.
    for (const field of ['rank', 'grants', 'authority', 'ranks', 'canPromote', 'requiredRole']) {
      expect(entry).not.toHaveProperty(field);
    }
    expect(Object.keys(entry).sort()).toEqual(['buckets', 'never']);
  });

  it('shares no value with the governance rank space (concepts stay disjoint)', () => {
    for (const rank of GOVERNANCE_RANKS) {
      expect(bucketsFor(CHARTER_ROLE_KEY)).not.toContain(rank);
      expect(isValidValue(CHARTER_ROLE_KEY, rank)).toBe(false);
    }
  });
});

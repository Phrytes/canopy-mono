/**
 * i18nMerge — pure-fn coverage for the shared-locale merge helper.
 *
 * Phase 41.18 follow-up (2026-05-10).
 */

import { describe, it, expect } from 'vitest';
import { mergeLocales, lookupKey } from '../../src/ui/i18nMerge.js';

const SHARED = {
  shared: {
    status: {
      claimed:   { text: 'claimed',   doc: 'shared label' },
      submitted: { text: 'submitted', doc: 'shared label' },
    },
    roles: {
      admin: { text: 'admin', doc: 'shared role' },
    },
  },
};

const MOBILE = {
  mobile: {
    welcome: {
      create_cta: { text: 'Create a new crew', doc: 'mobile-only' },
    },
  },
  // Override one shared label.
  shared: {
    status: {
      claimed: { text: 'mine', doc: 'mobile-overrides-shared' },
    },
  },
};

describe('mergeLocales', () => {
  it('merges disjoint top-level namespaces', () => {
    const out = mergeLocales(SHARED, MOBILE);
    expect(out.mobile.welcome.create_cta.text).toBe('Create a new crew');
    expect(out.shared.roles.admin.text).toBe('admin');
  });

  it('shell-local key wins on collision', () => {
    const out = mergeLocales(SHARED, MOBILE);
    expect(out.shared.status.claimed.text).toBe('mine');
    // The non-overridden sibling still comes from shared.
    expect(out.shared.status.submitted.text).toBe('submitted');
  });

  it('handles null inputs gracefully', () => {
    expect(mergeLocales(null, MOBILE)).toBe(MOBILE);
    expect(mergeLocales(SHARED, null)).toBe(SHARED);
  });
});

describe('lookupKey', () => {
  const merged = mergeLocales(SHARED, MOBILE);

  it('reads a leaf via dotted path', () => {
    expect(lookupKey(merged, 'shared.status.submitted')).toBe('submitted');
    expect(lookupKey(merged, 'shared.status.claimed')).toBe('mine');
    expect(lookupKey(merged, 'mobile.welcome.create_cta')).toBe('Create a new crew');
  });

  it('returns the fallback when the path is absent', () => {
    expect(lookupKey(merged, 'shared.status.nonexistent', '—')).toBe('—');
    expect(lookupKey(merged, 'totally.missing.path', 'fb')).toBe('fb');
  });

  it('empty / non-string path → fallback', () => {
    expect(lookupKey(merged, '', 'fb')).toBe('fb');
    expect(lookupKey(merged, null, 'fb')).toBe('fb');
  });
});

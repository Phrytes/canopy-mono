/**
 * offeringPicker — coverage for the `localiseField` helper.
 *
 * The component itself is JSX-only; render-level coverage lands in
 * Phase 40.10.6's deferred render harness.
 */

import { describe, it, expect } from 'vitest';
import { localiseField } from '../src/lib/offeringPicker.js';

describe('localiseField', () => {
  it('returns the language-specific string when present', () => {
    expect(localiseField({ nl: 'Tuin', en: 'Garden' }, 'nl')).toBe('Tuin');
    expect(localiseField({ nl: 'Tuin', en: 'Garden' }, 'en')).toBe('Garden');
  });
  it('falls back to en, then nl', () => {
    expect(localiseField({ nl: 'Tuin', en: 'Garden' }, 'de')).toBe('Garden');
    expect(localiseField({ nl: 'Tuin' }, 'de')).toBe('Tuin');
  });
  it('passes plain strings through', () => {
    expect(localiseField('plain', 'nl')).toBe('plain');
  });
  it('returns "" for null / undefined / non-object', () => {
    expect(localiseField(null, 'nl')).toBe('');
    expect(localiseField(undefined, 'nl')).toBe('');
    expect(localiseField(42, 'nl')).toBe('');
  });
});

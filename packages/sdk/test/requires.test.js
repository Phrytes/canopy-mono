import { describe, it, expect } from 'vitest';
import { CAPABILITIES, REQUIRES_CODES, validateRequires } from '../src/requires.js';

/**
 * SP-9 — the `requires` capability vocabulary + validator (the SP-10 seam).
 */

describe('CAPABILITIES vocabulary', () => {
  it('is the fixed SP-9 sub-path/extension set', () => {
    expect([...CAPABILITIES].sort()).toEqual(['core', 'high', 'pod', 'transports', 'vault']);
  });
  it('is frozen (a closed vocabulary)', () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
  });
});

describe('validateRequires — vocabulary check', () => {
  it('a valid set → ok, no findings', () => {
    const r = validateRequires(['core', 'vault', 'high']);
    expect(r).toEqual({ ok: true, missing: [], unknown: [] });
  });

  it('an unknown capability → not ok, reported in `unknown` with a CODE', () => {
    const r = validateRequires(['core', 'blockchain']);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual([{ capability: 'blockchain', code: REQUIRES_CODES.UNKNOWN }]);
    expect(r.missing).toEqual([]);
    // Codes, not free-text strings.
    expect(r.unknown[0].code).toBe('ERR_REQUIRES_UNKNOWN_CAPABILITY');
  });

  it('an empty requires list → trivially ok', () => {
    expect(validateRequires([]).ok).toBe(true);
  });
});

describe('validateRequires — available/presence check', () => {
  it('a known-but-absent capability → reported in `missing` with a CODE', () => {
    const r = validateRequires(['core', 'pod'], { available: ['core'] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ capability: 'pod', code: REQUIRES_CODES.MISSING }]);
    expect(r.unknown).toEqual([]);
    expect(r.missing[0].code).toBe('ERR_REQUIRES_MISSING_CAPABILITY');
  });

  it('all required present in available → ok', () => {
    const r = validateRequires(['core', 'high'], { available: ['core', 'high', 'vault'] });
    expect(r).toEqual({ ok: true, missing: [], unknown: [] });
  });

  it('an unknown capability is reported as unknown ONLY, never also missing', () => {
    const r = validateRequires(['bogus'], { available: ['core'] });
    expect(r.unknown).toEqual([{ capability: 'bogus', code: REQUIRES_CODES.UNKNOWN }]);
    expect(r.missing).toEqual([]);
  });

  it('unknown + missing accumulate independently', () => {
    const r = validateRequires(['core', 'pod', 'bogus'], { available: ['core'] });
    expect(r.ok).toBe(false);
    expect(r.unknown.map((u) => u.capability)).toEqual(['bogus']);
    expect(r.missing.map((m) => m.capability)).toEqual(['pod']);
  });

  it('omitting `available` skips the presence check (nothing can be missing)', () => {
    const r = validateRequires(['core', 'pod', 'high']);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('validateRequires — input guarding', () => {
  it('throws when `requires` is not an array', () => {
    expect(() => validateRequires('core')).toThrow(TypeError);
  });
  it('throws when `available` is given but not an array', () => {
    expect(() => validateRequires(['core'], { available: 'core' })).toThrow(TypeError);
  });
});

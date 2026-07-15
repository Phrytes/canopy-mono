// k-anon suppression at read + the device warning heuristic.
import { describe, it, expect } from 'vitest';
import { suppressRareAttributes, attributeKDefault } from '../src/kAnon.js';
import { disclosureWarning } from '../src/deviceWarning.js';

describe('attributeKDefault', () => {
  it('floors at 5 and never drops below the aggregation k', () => {
    expect(attributeKDefault(3)).toBe(5);
    expect(attributeKDefault(8)).toBe(8);
    expect(attributeKDefault(undefined)).toBe(5);
  });
});

describe('suppressRareAttributes', () => {
  const recs = (combos) => combos.map((a, i) => ({ id: `r${i}`, attributes: a }));

  it('suppresses a combo held by fewer than k participants', () => {
    // 3 share {role:resident}; 1 has a unique {role:visitor}. k=3 → the loner is suppressed.
    const records = recs([
      { role: 'resident' }, { role: 'resident' }, { role: 'resident' },
      { role: 'visitor' },
    ]);
    const out = suppressRareAttributes(records, { attributeK: 3 });
    expect(out.slice(0, 3).every((r) => r.attributes.role === 'resident')).toBe(true);
    expect(out[3].attributes).toEqual({});          // rare → stripped (no marker)
  });

  it('treats combos order-independently', () => {
    const records = recs([
      { role: 'resident', ageBand: '35-54' },
      { ageBand: '35-54', role: 'resident' },
    ]);
    const out = suppressRareAttributes(records, { attributeK: 2 });
    expect(out.every((r) => r.attributes.role === 'resident')).toBe(true);   // same combo, count 2 ≥ 2
  });

  it('leaves fully-withheld records untouched (empty combo carries nothing)', () => {
    const out = suppressRareAttributes(recs([{}, {}]), { attributeK: 5 });
    expect(out).toEqual([{ id: 'r0', attributes: {} }, { id: 'r1', attributes: {} }]);
  });

  it('does not mutate the input records', () => {
    const records = recs([{ role: 'visitor' }]);
    suppressRareAttributes(records, { attributeK: 3 });
    expect(records[0].attributes).toEqual({ role: 'visitor' });
  });
});

describe('disclosureWarning', () => {
  it('warns when ≥2 attributes and the combo space likely exceeds the cohort', () => {
    // ageBand(4) × role(4) = 16 combos > n=8 → probably unique.
    expect(disclosureWarning({ enabledKeys: ['ageBand', 'role'], n: 8 }).warn).toBe(true);
  });

  it('does not warn for a single attribute', () => {
    expect(disclosureWarning({ enabledKeys: ['role'], n: 3 }).warn).toBe(false);
  });

  it('does not warn when the cohort is larger than the combo space', () => {
    // ageBand(4) × role(4) = 16 combos < n=100.
    expect(disclosureWarning({ enabledKeys: ['ageBand', 'role'], n: 100 }).warn).toBe(false);
  });

  it('place weighs heavily → warns even in a fairly large cohort', () => {
    const v = disclosureWarning({ enabledKeys: ['place', 'ageBand'], n: 50 });
    expect(v.warn).toBe(true);
    expect(v.comboSpace).toBeGreaterThan(50);
  });

  it('is inert without a known cohort size', () => {
    expect(disclosureWarning({ enabledKeys: ['place', 'ageBand', 'role'] }).warn).toBe(false);
  });
});

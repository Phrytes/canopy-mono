/**
 * γ.4 — rulesConflict substrate tests.  Pure: no DOM.
 *
 * Rules docs are flat (no `blocks` array), so detection always produces
 * an empty `blockConflicts` and uses only `metaConflicts`.  Resolutions
 * default to 'theirs' (incoming wins) when a divergent field has no
 * explicit decision — see the module docstring for the rationale.
 */
import { describe, it, expect } from 'vitest';
import {
  detectRulesConflicts, applyRulesResolution,
} from '../../src/v2/rulesConflict.js';

/* ─────────────────────────────────────────────────────────────────────── */
/* detectRulesConflicts                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('detectRulesConflicts · γ.4', () => {
  it('identical local + incoming → identical:true, no conflicts', () => {
    const base  = { purpose: 'p', agreements: 'a' };
    const local = { purpose: 'p', agreements: 'a' };
    const inc   = { purpose: 'p', agreements: 'a' };
    const r = detectRulesConflicts(local, inc, base);
    expect(r.identical).toBe(true);
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toEqual([]);
  });

  it('one field changed only on local → toMerge, no conflicts', () => {
    const base  = { purpose: 'old' };
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'old' };
    const r = detectRulesConflicts(local, inc, base);
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toEqual([]);
    expect(r.identical).toBe(false);
    expect(r.toMerge.length).toBeGreaterThan(0);
  });

  it('same field changed both sides → one metaConflict', () => {
    const base  = { purpose: 'base' };
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'theirs' };
    const r = detectRulesConflicts(local, inc, base);
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toHaveLength(1);
    expect(r.metaConflicts[0].path).toEqual(['purpose']);
    expect(r.metaConflicts[0].yours).toBe('mine');
    expect(r.metaConflicts[0].theirs).toBe('theirs');
  });

  it('null base + divergent values → conflict surfaces', () => {
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'theirs' };
    const r = detectRulesConflicts(local, inc, null);
    expect(r.metaConflicts).toHaveLength(1);
    expect(r.metaConflicts[0].path).toEqual(['purpose']);
  });

  it('blockConflicts is ALWAYS empty (rules has no blocks array)', () => {
    const local = { purpose: 'a', agreements: 'b' };
    const inc   = { purpose: 'c', agreements: 'd' };
    const r = detectRulesConflicts(local, inc, { purpose: '', agreements: '' });
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toHaveLength(2);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/* applyRulesResolution                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('applyRulesResolution · γ.4', () => {
  it("decisions['purpose']='yours' keeps the local value", () => {
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'theirs' };
    const out = applyRulesResolution(local, inc, { purpose: 'yours' });
    expect(out.purpose).toBe('mine');
  });

  it("decisions['purpose']='theirs' takes the incoming value", () => {
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'theirs' };
    const out = applyRulesResolution(local, inc, { purpose: 'theirs' });
    expect(out.purpose).toBe('theirs');
  });

  it('missing decision defaults to theirs (incoming wins)', () => {
    const local = { purpose: 'mine', agreements: 'mine-a' };
    const inc   = { purpose: 'theirs', agreements: 'theirs-a' };
    const out = applyRulesResolution(local, inc, {});
    expect(out.purpose).toBe('theirs');
    expect(out.agreements).toBe('theirs-a');
  });

  it("mixed decisions compose: 'purpose'='yours' + 'agreements'='theirs'", () => {
    const local = { purpose: 'mine-p', agreements: 'mine-a' };
    const inc   = { purpose: 'theirs-p', agreements: 'theirs-a' };
    const out = applyRulesResolution(local, inc, {
      purpose: 'yours',
      agreements: 'theirs',
    });
    expect(out.purpose).toBe('mine-p');
    expect(out.agreements).toBe('theirs-a');
  });

  it('preserves a local-only key that is absent from incoming', () => {
    // A truly local field shouldn't silently disappear when the merge
    // base = incoming (lossless behaviour).
    const local = { purpose: 'p', responsibility: 'r-local-only' };
    const inc   = { purpose: 'p' };
    const out = applyRulesResolution(local, inc, {});
    expect(out.responsibility).toBe('r-local-only');
    expect(out.purpose).toBe('p');
  });

  it("invalid pick values (e.g. 'both' for rules) are ignored", () => {
    const local = { purpose: 'mine' };
    const inc   = { purpose: 'theirs' };
    const out = applyRulesResolution(local, inc, { purpose: 'both' });
    // 'both' isn't a valid rules decision; falls back to default (theirs).
    expect(out.purpose).toBe('theirs');
  });

  it('null/empty decisions object → all incoming', () => {
    const local = { purpose: 'l', agreements: 'l2' };
    const inc   = { purpose: 't', agreements: 't2' };
    expect(applyRulesResolution(local, inc).purpose).toBe('t');
    expect(applyRulesResolution(local, inc, null).purpose).toBe('t');
  });
});

/**
 * γ.3 — recipeConflict substrate tests.  Pure: no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  detectRecipeConflicts, applyResolution,
} from '../../src/v2/recipeConflict.js';

/* ─────────────────────────────────────────────────────────────────────── */
/* helpers — Recipe fixtures.                                             */
/* ─────────────────────────────────────────────────────────────────────── */

function recipe(name, blocks) {
  return { id: 'r1', name, blocks };
}
function blk(id, type, config = {}) {
  return { id, type, config };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* detectRecipeConflicts                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('detectRecipeConflicts · γ.3', () => {
  it('identical local + incoming → identical:true, no conflicts', () => {
    const base    = recipe('A', [blk('b1', 'text', { text: 'hi' })]);
    const local   = recipe('A', [blk('b1', 'text', { text: 'hi' })]);
    const inc     = recipe('A', [blk('b1', 'text', { text: 'hi' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.identical).toBe(true);
    expect(r.blockConflicts).toHaveLength(0);
    expect(r.metaConflicts).toHaveLength(0);
  });

  it('one block changed only on local → toMerge, no conflicts', () => {
    const base = recipe('A', [blk('b1', 'text', { text: 'old' })]);
    const local = recipe('A', [blk('b1', 'text', { text: 'new-local' })]);
    const inc   = recipe('A', [blk('b1', 'text', { text: 'old' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.blockConflicts).toHaveLength(0);
    expect(r.metaConflicts).toHaveLength(0);
    expect(r.identical).toBe(false);
    expect(r.toMerge.length).toBeGreaterThan(0);
  });

  it('same block changed both sides → one blockConflicts entry', () => {
    const base = recipe('A', [blk('b1', 'text', { text: 'base' })]);
    const local = recipe('A', [blk('b1', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('b1', 'text', { text: 'theirs' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.blockConflicts).toHaveLength(1);
    expect(r.blockConflicts[0].blockId).toBe('b1');
    expect(r.blockConflicts[0].conflicts).toHaveLength(1);
    expect(r.blockConflicts[0].conflicts[0].path).toEqual(['blocks', 'b1', 'config', 'text']);
    expect(r.blockConflicts[0].conflicts[0].yours).toBe('mine');
    expect(r.blockConflicts[0].conflicts[0].theirs).toBe('theirs');
    expect(r.metaConflicts).toHaveLength(0);
  });

  it('two different blocks each changed on one side only → toMerge, no conflicts', () => {
    const base = recipe('A', [
      blk('b1', 'text', { text: 'p1' }),
      blk('b2', 'text', { text: 'p2' }),
    ]);
    const local = recipe('A', [
      blk('b1', 'text', { text: 'mine' }),
      blk('b2', 'text', { text: 'p2' }),
    ]);
    const inc = recipe('A', [
      blk('b1', 'text', { text: 'p1' }),
      blk('b2', 'text', { text: 'theirs' }),
    ]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.blockConflicts).toHaveLength(0);
    expect(r.metaConflicts).toHaveLength(0);
    expect(r.toMerge.length).toBeGreaterThan(0);
  });

  it('both sides edit recipe.name → one metaConflicts entry', () => {
    const base = recipe('Original', [blk('b1', 'text', { text: 'x' })]);
    const local = recipe('Mine', [blk('b1', 'text', { text: 'x' })]);
    const inc   = recipe('Theirs', [blk('b1', 'text', { text: 'x' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.metaConflicts).toHaveLength(1);
    expect(r.metaConflicts[0].path).toEqual(['name']);
    expect(r.metaConflicts[0].yours).toBe('Mine');
    expect(r.metaConflicts[0].theirs).toBe('Theirs');
    expect(r.blockConflicts).toHaveLength(0);
  });

  it('local DELETED a block; incoming MODIFIED it → block-level conflict with yours=undefined', () => {
    const base = recipe('A', [blk('b1', 'text', { text: 'base' })]);
    const local = recipe('A', []);
    const inc   = recipe('A', [blk('b1', 'text', { text: 'edited' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.blockConflicts).toHaveLength(1);
    expect(r.blockConflicts[0].blockId).toBe('b1');
    expect(r.blockConflicts[0].conflicts[0].path).toEqual(['blocks', 'b1']);
    expect(r.blockConflicts[0].conflicts[0].yours).toBeUndefined();
    expect(r.blockConflicts[0].conflicts[0].theirs).toEqual({ id: 'b1', type: 'text', config: { text: 'edited' } });
  });

  it('null base (no version captured): same value on both sides → identical:true', () => {
    const local = recipe('A', [blk('b1', 'text', { text: 'x' })]);
    const inc   = recipe('A', [blk('b1', 'text', { text: 'x' })]);
    const r = detectRecipeConflicts(local, inc, null);
    expect(r.identical).toBe(true);
  });

  it('null base + divergent values → conflict surfaces (no ancestor to disambiguate)', () => {
    const local = recipe('A', [blk('b1', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('b1', 'text', { text: 'theirs' })]);
    const r = detectRecipeConflicts(local, inc, null);
    expect(r.blockConflicts).toHaveLength(1);
    expect(r.blockConflicts[0].blockId).toBe('b1');
  });

  it('multiple block conflicts: collapse to one entry per blockId', () => {
    // b1 has two field-level conflicts (text + extra).  detect should
    // group both into a single { blockId:'b1', conflicts:[2 entries] }.
    const base = recipe('A', [blk('b1', 'photo', { src: 'b-src', caption: 'b-cap' })]);
    const local = recipe('A', [blk('b1', 'photo', { src: 'mine-src', caption: 'mine-cap' })]);
    const inc   = recipe('A', [blk('b1', 'photo', { src: 'their-src', caption: 'their-cap' })]);
    const r = detectRecipeConflicts(local, inc, base);
    expect(r.blockConflicts).toHaveLength(1);
    expect(r.blockConflicts[0].blockId).toBe('b1');
    expect(r.blockConflicts[0].conflicts).toHaveLength(2);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/* applyResolution                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('applyResolution · γ.3', () => {
  it("decisions['A']='yours' keeps the local block", () => {
    const local = recipe('A', [blk('A', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('A', 'text', { text: 'theirs' })]);
    const out = applyResolution(local, inc, { A: 'yours' });
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toEqual({ id: 'A', type: 'text', config: { text: 'mine' } });
  });

  it("decisions['A']='theirs' takes the incoming block", () => {
    const local = recipe('A', [blk('A', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('A', 'text', { text: 'theirs' })]);
    const out = applyResolution(local, inc, { A: 'theirs' });
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toEqual({ id: 'A', type: 'text', config: { text: 'theirs' } });
  });

  it("decisions['A']='both' keeps BOTH; the incoming variant has a fresh id", () => {
    const local = recipe('A', [blk('A', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('A', 'text', { text: 'theirs' })]);
    const out = applyResolution(local, inc, { A: 'both' });
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]).toEqual({ id: 'A', type: 'text', config: { text: 'mine' } });
    // Incoming variant has a fresh id (NOT 'A') and carries the incoming config.
    expect(out.blocks[1].id).not.toBe('A');
    expect(out.blocks[1].id).toMatch(/-incoming$/);
    expect(out.blocks[1].type).toBe('text');
    expect(out.blocks[1].config).toEqual({ text: 'theirs' });
  });

  it("no decision for a block defaults to 'yours' (preserve local)", () => {
    const local = recipe('A', [blk('A', 'text', { text: 'mine' })]);
    const inc   = recipe('A', [blk('A', 'text', { text: 'theirs' })]);
    const out = applyResolution(local, inc, {});
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toEqual({ id: 'A', type: 'text', config: { text: 'mine' } });
  });

  it("meta decision via 'name'='theirs' replaces the field with incoming value", () => {
    const local = recipe('Mine', [blk('A', 'text', { text: 'x' })]);
    const inc   = recipe('Theirs', [blk('A', 'text', { text: 'x' })]);
    const out = applyResolution(local, inc, { name: 'theirs' });
    expect(out.name).toBe('Theirs');
    expect(out.blocks).toEqual([{ id: 'A', type: 'text', config: { text: 'x' } }]);
  });

  it('meta and block decisions compose', () => {
    const local = recipe('Mine', [blk('A', 'text', { text: 'mine' })]);
    const inc   = recipe('Theirs', [blk('A', 'text', { text: 'theirs' })]);
    const out = applyResolution(local, inc, { name: 'theirs', A: 'both' });
    expect(out.name).toBe('Theirs');
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0].config.text).toBe('mine');
    expect(out.blocks[1].config.text).toBe('theirs');
  });

  it('local-only block + no decision is preserved', () => {
    const local = recipe('A', [blk('A', 'text', { text: 'x' }), blk('B', 'text', { text: 'y' })]);
    const inc   = recipe('A', [blk('A', 'text', { text: 'x' })]);
    const out = applyResolution(local, inc, {});
    expect(out.blocks.map((b) => b.id)).toEqual(['A', 'B']);
  });

  it("incoming-only block defaults to included (one-sided add); 'yours' drops it", () => {
    const local = recipe('A', [blk('A', 'text', { text: 'x' })]);
    const inc   = recipe('A', [
      blk('A', 'text', { text: 'x' }),
      blk('NEW', 'text', { text: 'newcomer' }),
    ]);
    const dflt = applyResolution(local, inc, {});
    expect(dflt.blocks.map((b) => b.id)).toEqual(['A', 'NEW']);
    const dropped = applyResolution(local, inc, { NEW: 'yours' });
    expect(dropped.blocks.map((b) => b.id)).toEqual(['A']);
  });

  it('round-trips multi-block recipes with mixed decisions in stable local order', () => {
    const local = recipe('R', [
      blk('A', 'text', { text: 'a-mine' }),
      blk('B', 'text', { text: 'b-mine' }),
      blk('C', 'text', { text: 'c-mine' }),
    ]);
    const inc = recipe('R', [
      blk('A', 'text', { text: 'a-theirs' }),
      blk('B', 'text', { text: 'b-theirs' }),
      blk('C', 'text', { text: 'c-theirs' }),
    ]);
    const out = applyResolution(local, inc, { A: 'theirs', B: 'yours', C: 'both' });
    expect(out.blocks).toHaveLength(4);
    expect(out.blocks[0].config.text).toBe('a-theirs');
    expect(out.blocks[1].config.text).toBe('b-mine');
    expect(out.blocks[2].config.text).toBe('c-mine');
    expect(out.blocks[3].config.text).toBe('c-theirs');
    expect(out.blocks[3].id).toMatch(/-incoming$/);
  });
});

/**
 * γ.4 — policyConflict substrate tests.  Pure: no DOM.
 *
 * The circle policy has nested objects (push, features, flowThrough);
 * conflict paths can be deeper than one segment (e.g. ['push',
 * 'onMention']).  The resolver renders the dotted `path.join('.')`
 * as the field label.
 */
import { describe, it, expect } from 'vitest';
import {
  detectPolicyConflicts, applyPolicyResolution,
} from '../../src/v2/policyConflict.js';

/* ─────────────────────────────────────────────────────────────────────── */
/* detectPolicyConflicts                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('detectPolicyConflicts · γ.4', () => {
  it('identical local + incoming → identical:true, no conflicts', () => {
    const base  = { view: 'screen', features: { chat: true } };
    const local = { view: 'screen', features: { chat: true } };
    const inc   = { view: 'screen', features: { chat: true } };
    const r = detectPolicyConflicts(local, inc, base);
    expect(r.identical).toBe(true);
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toEqual([]);
  });

  it('one top-level axis changed only on local → toMerge, no conflicts', () => {
    const base  = { view: 'screen' };
    const local = { view: 'chat' };
    const inc   = { view: 'screen' };
    const r = detectPolicyConflicts(local, inc, base);
    expect(r.blockConflicts).toEqual([]);
    expect(r.metaConflicts).toEqual([]);
    expect(r.toMerge.length).toBeGreaterThan(0);
  });

  it('same axis changed both sides → one metaConflict at top-level path', () => {
    const base  = { view: 'screen' };
    const local = { view: 'chat' };
    const inc   = { view: 'cross-stream' };
    const r = detectPolicyConflicts(local, inc, base);
    expect(r.metaConflicts).toHaveLength(1);
    expect(r.metaConflicts[0].path).toEqual(['view']);
    expect(r.metaConflicts[0].yours).toBe('chat');
    expect(r.metaConflicts[0].theirs).toBe('cross-stream');
  });

  it('nested field divergence surfaces with a multi-segment path', () => {
    const base  = { push: { onMention: true,  onEveryMessage: false } };
    const local = { push: { onMention: false, onEveryMessage: false } };
    const inc   = { push: { onMention: true,  onEveryMessage: true  } };
    const r = detectPolicyConflicts(local, inc, base);
    // Two paths changed on disjoint sides → both go to toMerge, not conflicts.
    expect(r.metaConflicts).toEqual([]);
    expect(r.toMerge.length).toBe(2);
  });

  it('SAME nested field changed both sides → conflict with deep path', () => {
    const base  = { push: { onMention: true } };
    const local = { push: { onMention: false } };
    const inc   = { push: { onMention: true,  onEveryMessage: true } };
    // local changed onMention, incoming added onEveryMessage; only onMention
    // is divergent.  But base has onMention=true, local=false, incoming=true →
    // local-only change ⇒ toMerge.  Pick a tighter fixture:
    const base2  = { push: { onMention: true } };
    const local2 = { push: { onMention: false } };
    const inc2   = { push: { onMention: 'maybe' } };
    const r2 = detectPolicyConflicts(local2, inc2, base2);
    expect(r2.metaConflicts).toHaveLength(1);
    expect(r2.metaConflicts[0].path).toEqual(['push', 'onMention']);
    expect(r2.metaConflicts[0].yours).toBe(false);
    expect(r2.metaConflicts[0].theirs).toBe('maybe');
    // The first fixture should produce a clean toMerge.
    const r1 = detectPolicyConflicts(local, inc, base);
    expect(r1.metaConflicts).toEqual([]);
  });

  it('blockConflicts is ALWAYS empty (policy has no blocks array)', () => {
    const local = { view: 'a' };
    const inc   = { view: 'b' };
    const r = detectPolicyConflicts(local, inc, { view: '' });
    expect(r.blockConflicts).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/* applyPolicyResolution                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('applyPolicyResolution · γ.4', () => {
  it("decisions['view']='yours' keeps the local value", () => {
    const local = { view: 'chat' };
    const inc   = { view: 'screen' };
    const out = applyPolicyResolution(local, inc, { view: 'yours' });
    expect(out.view).toBe('chat');
  });

  it("decisions['view']='theirs' takes the incoming value", () => {
    const local = { view: 'chat' };
    const inc   = { view: 'screen' };
    const out = applyPolicyResolution(local, inc, { view: 'theirs' });
    expect(out.view).toBe('screen');
  });

  it('missing decision defaults to theirs (incoming wins)', () => {
    const local = { view: 'chat', llmTool: 'cloud' };
    const inc   = { view: 'screen', llmTool: 'off' };
    const out = applyPolicyResolution(local, inc, {});
    expect(out.view).toBe('screen');
    expect(out.llmTool).toBe('off');
  });

  it('nested-path decision overlays only that leaf', () => {
    const local = { push: { onMention: false, onEveryMessage: false } };
    const inc   = { push: { onMention: true,  onEveryMessage: true  } };
    const out = applyPolicyResolution(local, inc, { 'push.onMention': 'yours' });
    expect(out.push.onMention).toBe(false);
    // The other nested leaf falls back to incoming.
    expect(out.push.onEveryMessage).toBe(true);
  });

  it('preserves a local-only top-level key absent from incoming', () => {
    const local = { view: 'chat', somethingLocalOnly: 'x' };
    const inc   = { view: 'screen' };
    const out = applyPolicyResolution(local, inc, {});
    expect(out.somethingLocalOnly).toBe('x');
    expect(out.view).toBe('screen');
  });

  it('does NOT mutate the incoming object (deep clone)', () => {
    const inc = { push: { onMention: true } };
    const local = { push: { onMention: false } };
    applyPolicyResolution(local, inc, { 'push.onMention': 'yours' });
    expect(inc.push.onMention).toBe(true);
  });

  it('null/empty decisions → all incoming', () => {
    const local = { view: 'chat' };
    const inc   = { view: 'screen' };
    expect(applyPolicyResolution(local, inc).view).toBe('screen');
    expect(applyPolicyResolution(local, inc, null).view).toBe('screen');
  });
});

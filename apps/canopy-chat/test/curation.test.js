/**
 * curation (P3) — compareForCuration reuses objectDiff; renderCuration is the
 * before/after curation look. One compute (objectDiff), two looks (folio
 * file-merge vs curation).
 */

import { describe, it, expect } from 'vitest';
import { compareForCuration, renderCuration } from '../src/v2/curation.js';

describe('compareForCuration', () => {
  it('text before/after — flags changed, no object diff', () => {
    const c = compareForCuration('raw msg with Jan', 'cleaned msg with [naam]');
    expect(c.changed).toBe(true);
    expect(c.diff).toBeNull();
    expect(c.before).toContain('Jan');
    expect(c.after).toContain('[naam]');
  });

  it('identical content → not changed', () => {
    expect(compareForCuration('same', 'same').changed).toBe(false);
    expect(compareForCuration({ a: 1 }, { a: 1 }).changed).toBe(false);
  });

  it('objects reuse objectDiff — before→after changes land in toMerge', () => {
    const c = compareForCuration({ text: 'hi', keep: 1 }, { text: 'hello', keep: 1 });
    expect(c.changed).toBe(true);
    expect(c.diff).toBeTruthy();
    expect(c.diff.toMerge.some((m) => m.path.join('.') === 'text')).toBe(true);
    expect(c.diff.identical).toBe(false);
  });
});

describe('renderCuration', () => {
  it('produces a before/after view model with the changed paths', () => {
    const view = renderCuration(compareForCuration({ text: 'hi' }, { text: 'bye' }));
    expect(view).toMatchObject({ kind: 'curation', changed: true });
    expect(view.sides).toEqual({ before: { text: 'hi' }, after: { text: 'bye' } });
    expect(view.changedPaths).toContain('text');
  });

  it('text content reports a single (content) change', () => {
    const view = renderCuration(compareForCuration('a', 'b'));
    expect(view.changed).toBe(true);
    expect(view.changedPaths).toEqual(['(content)']);
  });

  it('ONE compute feeds TWO looks (curation view + a merge-style summary)', () => {
    const comparison = compareForCuration({ a: 'x', b: 'y' }, { a: 'X', b: 'y' });
    const curation = renderCuration(comparison);                    // look #1: before/after
    const mergeSummary = { changes: comparison.diff.toMerge.length, identical: comparison.diff.identical }; // look #2: folio-style
    expect(curation.changedPaths).toEqual(['a']);
    expect(mergeSummary).toEqual({ changes: 1, identical: false });
  });
});

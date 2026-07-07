import { describe, it, expect } from 'vitest';
import { normalizeFolioFile, buildCircleFiles, circleFilesFromListFiles } from '../../src/v2/circleFolio.js';

describe('normalizeFolioFile', () => {
  it('keeps the supplied fields', () => {
    expect(normalizeFolioFile({
      id: 'f1', name: 'plan.md', kind: 'doc', size: 42, updatedAt: 300,
    })).toEqual({ id: 'f1', name: 'plan.md', kind: 'doc', size: 42, updatedAt: 300 });
  });

  it('name falls back to id, kind defaults to file', () => {
    expect(normalizeFolioFile({ id: 'f2' })).toMatchObject({ id: 'f2', name: 'f2', kind: 'file' });
  });

  it('non-numeric size/updatedAt become null/0', () => {
    const row = normalizeFolioFile({ id: 'f3', size: 'big' });
    expect(row.size).toBeNull();
    expect(row.updatedAt).toBe(0);
  });

  it('reads modifiedAt as an updatedAt alias', () => {
    expect(normalizeFolioFile({ id: 'f4', modifiedAt: 99 }).updatedAt).toBe(99);
  });

  it('tolerates a missing / non-object raw', () => {
    expect(normalizeFolioFile()).toMatchObject({ id: null, name: null, kind: 'file' });
    expect(normalizeFolioFile(null)).toMatchObject({ kind: 'file' });
  });
});

describe('buildCircleFiles', () => {
  it('keeps files matching the circle + untagged files, drops other-circle files', () => {
    const files = [
      { id: 'a', updatedAt: 300, circleId: 'crew-1' },
      { id: 'b', updatedAt: 200 },                       // untagged
      { id: 'c', updatedAt: 100, circleId: 'other' },    // other circle
      { id: 'd', updatedAt: 50,  audience: 'circle:crew-1' },
    ];
    const rows = buildCircleFiles({ files, circleId: 'crew-1' });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'd']);
  });

  it('returns newest-first by updatedAt (missing → 0)', () => {
    const files = [
      { id: 'old', updatedAt: 1 },
      { id: 'new', updatedAt: 9 },
      { id: 'none' },
    ];
    expect(buildCircleFiles({ files }).map((r) => r.id)).toEqual(['new', 'old', 'none']);
  });

  it('normalizes each row (name fallback, kind default)', () => {
    const [row] = buildCircleFiles({ files: [{ id: 'f1' }] });
    expect(row).toMatchObject({ id: 'f1', name: 'f1', kind: 'file', updatedAt: 0 });
  });

  it('a null circleId keeps everything (unscoped)', () => {
    const files = [{ id: 'x', circleId: 'crew-1' }, { id: 'y' }];
    expect(buildCircleFiles({ files }).map((r) => r.id).sort()).toEqual(['x', 'y']);
  });

  it('returns [] for empty / missing inputs', () => {
    expect(buildCircleFiles()).toEqual([]);
    expect(buildCircleFiles({ files: [], circleId: 'crew-1' })).toEqual([]);
    expect(buildCircleFiles({ files: [null, undefined], circleId: 'crew-1' })).toEqual([]);
  });
});

describe('circleFilesFromListFiles', () => {
  it('extracts the listFiles { items } shape and scopes to the circle', () => {
    const res = { items: [{ id: 'a', name: 'a.md' }, { id: 'b', name: 'b.md', circleId: 'other' }], _sync: {} };
    const rows = circleFilesFromListFiles(res, 'crew-1');
    expect(rows.map((r) => r.id).sort()).toEqual(['a']); // 'b' tagged to another circle is dropped
  });

  it('accepts { files } and bare-array shapes', () => {
    expect(circleFilesFromListFiles({ files: [{ id: 'x', name: 'x' }] }, null)).toHaveLength(1);
    expect(circleFilesFromListFiles([{ id: 'y', name: 'y' }], null)).toHaveLength(1);
  });

  it('tolerates null / malformed results', () => {
    expect(circleFilesFromListFiles(null, 'crew-1')).toEqual([]);
    expect(circleFilesFromListFiles({}, 'crew-1')).toEqual([]);
  });
});

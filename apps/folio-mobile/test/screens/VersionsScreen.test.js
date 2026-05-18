/**
 * VersionsScreen.test.js — the exported pure view-model mapper.
 *
 * Per folio-mobile convention the React screen isn't unit-rendered;
 * `toVersionRows` (engine.versions() output → display rows) carries
 * the logic and is tested here.
 */

import { describe, it, expect } from 'vitest';
import { toVersionRows } from '../../src/lib/versionRows.js';

describe('toVersionRows', () => {
  it('returns [] for a non-array / missing input', () => {
    expect(toVersionRows(undefined)).toEqual([]);
    expect(toVersionRows(null)).toEqual([]);
    expect(toVersionRows('nope')).toEqual([]);
    expect(toVersionRows([])).toEqual([]);
  });

  it('sorts newest ts first and shortens the sha', () => {
    const rows = toVersionRows([
      { ts: 100, sha256: 'aaaaaaaa1111', size: 10, path: '/v/a' },
      { ts: 300, sha256: 'cccccccc3333', size: 30, path: '/v/c' },
      { ts: 200, sha256: 'bbbbbbbb2222', size: 20, path: '/v/b' },
    ]);
    expect(rows.map((r) => r.ts)).toEqual([300, 200, 100]);
    expect(rows[0]).toEqual({ ts: 300, size: 30, sha8: 'cccccccc', path: '/v/c' });
  });

  it('defaults missing size→0 and missing sha→"" and drops ts-less entries', () => {
    const rows = toVersionRows([
      { ts: 5 },
      { sha256: 'zz' },          // no ts → dropped
      { ts: NaN, size: 9 },      // non-finite ts → dropped
    ]);
    expect(rows).toEqual([{ ts: 5, size: 0, sha8: '', path: '' }]);
  });
});

// Tests for the codename naming-hygiene guard (scripts/lint-codenames.mjs +
// scripts/codenames-scope.mjs).
//   npm run test:codenames   (root)  →  vitest run scripts/lint-codenames.test.mjs
//
// Covers: the curated patterns FLAG real codenames; the low-false-positive
// commitments (lookalikes NOT flagged); comments/prose are scanned but code/
// strings/fenced-code are NOT; and the forward-protection invariant — the real
// tree is CLEAN today, so any new codename in a scoped comment/doc fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tracked, isScopedCode, isScopedDoc,
  commentMask, docProseMask, findCodenames,
} from './codenames-scope.mjs';

const ids = (s, mask = commentMask) => findCodenames(mask(s)).map((h) => h.id);

describe('curated patterns FLAG real internal codenames', () => {
  const cases = [
    ['// cluster K · K2 — composable lists', 'cluster-K'],
    ['// the K2 containment substrate', 'K-spike'],
    ['// SP-13.2 — kring stream', 'SP-n'],
    ['// SP-3b consumer-switch', 'SP-n'],
    ['// board 5B shows action buttons', 'board-n'],
    ['// Q27 confirm gate', 'Q-n'],
    ['// same Q15 pattern', 'Q-n'],
    ['// P2 CONTROL ops', 'P-phase'],
    ['// P6.M7 folio notes-list', 'P-phase'],
    ['// P6.9 first-run mnemonic', 'P-phase'],
    ['// closes issue #347 in the tracker', 'issue-ref'],
    ['// B · Slice 4 — the capability gate', 'slice-n'],
    ['// read slice 2026-07-09', 'slice-n'],
    ['// V2.8 phase tag', 'V-tag'],
    ['// V0.2 adoption', 'V-tag'],
  ];
  for (const [line, id] of cases) {
    it(`flags ${JSON.stringify(line)} as ${id}`, () => {
      expect(ids(line)).toContain(id);
    });
  }
});

describe('LOW FALSE-POSITIVE: lookalikes are NOT flagged', () => {
  const clean = [
    '// the keyboard 3 rows below',       // "board 3" must need a word boundary
    '// a P2P transport hop',              // P2P is not a P2 phase label
    '// bumped to #12 in the list',        // 1–2 digit #refs are ordinals, not issue refs
    '// see item #7 above',
    '// the v2 design tier directory',     // lowercase v2 is a real dir, not a V-tag
    '// V2 without a dotted minor',        // needs V<n>.<n>
    '// the capability id tasks-v0 uses',  // load-bearing identifier, not a codename
    '// dispatchReady is the waist',       // no codename at all
    '// HTTP 404 / 500 handling',          // status codes, not issue refs
  ];
  for (const line of clean) {
    it(`does not flag ${JSON.stringify(line)}`, () => {
      expect(ids(line)).toEqual([]);
    });
  }
});

describe('scope: only COMMENTS / PROSE are scanned', () => {
  it('a codename inside a JS string literal is NOT flagged', () => {
    expect(ids(`const label = 'board 5B';`)).toEqual([]);
    expect(ids('const x = `cluster K`;')).toEqual([]);
  });
  it('a codename inside a JS comment IS flagged', () => {
    expect(ids(`const x = 1; // board 5B`)).toContain('board-n');
  });
  it('a codename inside a markdown fenced code block is NOT flagged', () => {
    const md = 'prose is clean here\n```\n// board 5B in a sample\n```\n';
    expect(ids(md, docProseMask)).toEqual([]);
  });
  it('a codename in markdown prose IS flagged', () => {
    expect(ids('This lands in board 5B of the design.', docProseMask)).toContain('board-n');
  });
  it('a bare #issue ref is flagged in CODE but NOT in doc prose (legit citation)', () => {
    const codeHits = findCodenames(commentMask('// see #347 for the fix'), 'code').map((h) => h.id);
    const docHits = findCodenames(docProseMask('Tracked as #347 in the matrix.'), 'doc').map((h) => h.id);
    expect(codeHits).toContain('issue-ref');
    expect(docHits).not.toContain('issue-ref');
  });
});

describe('FORWARD PROTECTION: the real tree is clean today', () => {
  it('no internal codename in any scoped source comment or doc', () => {
    const hits = [];
    for (const f of tracked()) {
      const code = isScopedCode(f);
      const doc = isScopedDoc(f);
      if (!code && !doc) continue;
      let src;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      const masked = code ? commentMask(src) : docProseMask(src);
      for (const h of findCodenames(masked, code ? 'code' : 'doc')) hits.push(`${f} [${h.id}: ${h.match}]`);
    }
    expect(hits, `codenames leaked back into scoped comments/docs:\n${hits.join('\n')}`).toEqual([]);
  });
});

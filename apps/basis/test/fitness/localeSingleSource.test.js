/**
 * FITNESS FUNCTION — locale single-source & web≡mobile parity.
 *
 * The recurring drift this repo fights (CLAUDE.md): duplicated locales — a
 * `circle.*` string edited in the web bundle AND a mobile copy, drifting apart.
 * The cure already landed: `circle.*` lives in ONE shared source
 * (apps/basis/src/locales/circle.{en,nl}.json), merged into BOTH shells.
 * These checks make the cure self-enforcing — re-introducing a mobile circle
 * copy, or adding a key to one language only, FAILS CI here.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));

const circleEn = read('../../src/locales/circle.en.json');
const circleNl = read('../../src/locales/circle.nl.json');

// Blocks that were consolidated into the shared source the same way `circle.*` was (invariant #3 —
// finishing the consolidation `circle.*` started). Each must live ONCE (src/locales/) and be merged
// into both shells, never re-declared per-shell.
const sharedBlocks = ['circle', 'consequence', 'role'];
const sharedByBlock = {
  circle: [circleEn, circleNl],
  consequence: [read('../../src/locales/consequence.en.json'), read('../../src/locales/consequence.nl.json')],
  role: [read('../../src/locales/role.en.json'), read('../../src/locales/role.nl.json')],
};

/** Collect every leaf path that carries a `text` string. */
function leafPaths(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  if (typeof obj.text === 'string') { out.add(prefix); return out; }
  for (const [k, v] of Object.entries(obj)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

describe('FITNESS: shared locale blocks are a single shared source', () => {
  const mobileEn = read('../../../basis-mobile/locales/en.json');
  const mobileNl = read('../../../basis-mobile/locales/nl.json');
  const webEn = read('../../locales/en.json');
  const webNl = read('../../locales/nl.json');
  for (const block of sharedBlocks) {
    it(`neither shell re-declares its own ${block}.* block (both merge the shared source)`, () => {
      for (const [name, bundle] of [['web en', webEn], ['web nl', webNl], ['mobile en', mobileEn], ['mobile nl', mobileNl]]) {
        expect(block in bundle, `${name}.json must not re-declare ${block}.* — use the shared source`).toBe(false);
      }
    });
  }
});

describe('FITNESS: shared locale blocks en ≡ nl by construction', () => {
  for (const block of sharedBlocks) {
    const [blockEn, blockNl] = sharedByBlock[block];
    it(`${block}: every English leaf key exists in Dutch and vice versa`, () => {
      const en = leafPaths(blockEn);
      const nl = leafPaths(blockNl);
      const missingInNl = [...en].filter((k) => !nl.has(k));
      const missingInEn = [...nl].filter((k) => !en.has(k));
      expect(missingInNl, `${block}: keys present in EN but missing in NL: ${missingInNl.join(', ')}`).toEqual([]);
      expect(missingInEn, `${block}: keys present in NL but missing in EN: ${missingInEn.join(', ')}`).toEqual([]);
    });

    it(`${block}: no leaf has an empty string in either language`, () => {
      const empties = [];
      const walk = (obj, lang, prefix = '') => {
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.text === 'string') { if (!obj.text.trim()) empties.push(`${lang}:${prefix}`); return; }
        for (const [k, v] of Object.entries(obj)) walk(v, lang, prefix ? `${prefix}.${k}` : k);
      };
      walk(blockEn, 'en'); walk(blockNl, 'nl');
      expect(empties, `${block}: empty locale strings: ${empties.join(', ')}`).toEqual([]);
    });
  }
});

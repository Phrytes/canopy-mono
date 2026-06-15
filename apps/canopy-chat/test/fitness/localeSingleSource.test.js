/**
 * FITNESS FUNCTION — locale single-source & web≡mobile parity.
 *
 * The recurring drift this repo fights (CLAUDE.md): duplicated locales — a
 * `circle.*` string edited in the web bundle AND a mobile copy, drifting apart.
 * The cure already landed: `circle.*` lives in ONE shared source
 * (apps/canopy-chat/src/locales/circle.{en,nl}.json), merged into BOTH shells.
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

/** Collect every leaf path that carries a `text` string. */
function leafPaths(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  if (typeof obj.text === 'string') { out.add(prefix); return out; }
  for (const [k, v] of Object.entries(obj)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

describe('FITNESS: circle locale is a single shared source', () => {
  it('the mobile bundle does NOT carry its own circle.* block (it merges the shared source)', () => {
    const mobileEn = read('../../../canopy-chat-mobile/locales/en.json');
    const mobileNl = read('../../../canopy-chat-mobile/locales/nl.json');
    expect('circle' in mobileEn, 'mobile en.json must not re-declare circle.* — use sharedCircleLocale').toBe(false);
    expect('circle' in mobileNl, 'mobile nl.json must not re-declare circle.* — use sharedCircleLocale').toBe(false);
  });
});

describe('FITNESS: circle locale en ≡ nl by construction', () => {
  it('every English leaf key exists in Dutch and vice versa', () => {
    const en = leafPaths(circleEn);
    const nl = leafPaths(circleNl);
    const missingInNl = [...en].filter((k) => !nl.has(k));
    const missingInEn = [...nl].filter((k) => !en.has(k));
    expect(missingInNl, `keys present in EN but missing in NL: ${missingInNl.join(', ')}`).toEqual([]);
    expect(missingInEn, `keys present in NL but missing in EN: ${missingInEn.join(', ')}`).toEqual([]);
  });

  it('no leaf has an empty string in either language', () => {
    const empties = [];
    const walk = (obj, lang, prefix = '') => {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.text === 'string') { if (!obj.text.trim()) empties.push(`${lang}:${prefix}`); return; }
      for (const [k, v] of Object.entries(obj)) walk(v, lang, prefix ? `${prefix}.${k}` : k);
    };
    walk(circleEn, 'en'); walk(circleNl, 'nl');
    expect(empties, `empty locale strings: ${empties.join(', ')}`).toEqual([]);
  });
});

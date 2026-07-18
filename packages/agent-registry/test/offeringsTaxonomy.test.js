// Offering fold-in (NOTE-skills-properties-audit Q1/Q4; rename NOTE-offering-rename-inventory.md) —
// the taxonomy as the COARSE rung of the `offering` property descriptor: deriveOfferingCategory
// (deterministic tag/keyword scoring) + the fail-closed coarsen (category rung drops text/tags,
// keeping only { categoryId }). "offering" = the human-profile "I can do X" DATA; the INVOCABLE A2A
// sense keeps the word "skill" and is unrelated here.
import { describe, it, expect } from 'vitest';
import {
  OFFERINGS_TAXONOMY, OFFERING_LADDER, deriveOfferingCategory, offeringDescriptor,
  createDriver, createVocabulary,
} from '../index.js';

describe('OFFERINGS_TAXONOMY (moved here from identity-resolver)', () => {
  it('exposes the fixed 10-category taxonomy with NL+EN labels, frozen', () => {
    expect(OFFERINGS_TAXONOMY.categories).toHaveLength(10);
    for (const c of OFFERINGS_TAXONOMY.categories) {
      expect(typeof c.id).toBe('string');
      expect(c.label.nl).toBeTruthy();
      expect(c.label.en).toBeTruthy();
    }
    expect(Object.isFrozen(OFFERINGS_TAXONOMY)).toBe(true);
  });

  it('OFFERING_LADDER runs coarsest→finest per the vocabulary convention', () => {
    expect(OFFERING_LADDER).toEqual(['category', 'full']);
  });
});

describe('deriveOfferingCategory — deterministic best-effort categoryId', () => {
  it('a tag equal to a category id wins outright', () => {
    expect(deriveOfferingCategory({ text: '', tags: ['vervoer'] })).toBe('vervoer');
    expect(deriveOfferingCategory({ tags: ['Tuin'] })).toBe('tuin');   // tags are normalised first
  });

  it('matches via label/hint keywords (NL + EN)', () => {
    expect(deriveOfferingCategory({ text: 'ik kan goed snoeien', tags: [] })).toBe('tuin');
    expect(deriveOfferingCategory({ text: 'babysitting on weekdays', tags: [] })).toBe('kinderopvang');
    expect(deriveOfferingCategory({ text: '', tags: ['belasting', 'formulieren'] })).toBe('administratie');
  });

  it('hyphenated tags match through their parts', () => {
    expect(deriveOfferingCategory({ tags: ['fietsreparatie-en-autohulp'] })).toBe('vervoer');
  });

  it('no evidence → null (never a guess)', () => {
    expect(deriveOfferingCategory({ text: 'zzz qqq', tags: ['xyzzy'] })).toBe(null);
    expect(deriveOfferingCategory({})).toBe(null);
    expect(deriveOfferingCategory(null)).toBe(null);
  });

  it('is deterministic: same input, same answer', () => {
    const item = { text: 'help with the computer and phone', tags: ['internet'] };
    expect(deriveOfferingCategory(item)).toBe('tech');
    expect(deriveOfferingCategory(item)).toBe(deriveOfferingCategory(item));
  });
});

describe('offeringDescriptor — the offering rung of the vocabulary', () => {
  const d = offeringDescriptor();

  it('registers as a driver-typed, sensitive descriptor with the category→full ladder', () => {
    expect(d.key).toBe('offering');
    expect(d.type).toBe('driver');
    expect(d.sensitivity).toBe('sensitive');
    expect(d.ladder).toEqual(['category', 'full']);
  });

  it('coarsen to category drops text+tags, keeping ONLY the derived { categoryId }', () => {
    const offering = createDriver({ kind: 'offering', text: 'ik repareer fietsen', tags: ['fiets'] });
    const coarse = d.coarsen(offering, 'category');
    expect(coarse).toEqual({ categoryId: 'vervoer' });
    expect(Object.keys(coarse)).toEqual(['categoryId']);   // no text/tags leak
  });

  it('read-accepts the legacy kind:"skill" as an offering (back-compat)', () => {
    const legacy = createDriver({ kind: 'skill', text: 'ik repareer fietsen', tags: ['fiets'] });
    expect(legacy.kind).toBe('offering');
    expect(d.coarsen(legacy, 'category')).toEqual({ categoryId: 'vervoer' });
  });

  it('a user-picked valid categoryId on the item wins over derivation', () => {
    const coarse = d.coarsen({ kind: 'offering', text: 'fietsen', tags: [], categoryId: 'anders' }, 'category');
    expect(coarse).toEqual({ categoryId: 'anders' });
    // an invalid pick is ignored → derived instead
    expect(d.coarsen({ text: 'fietsreparatie', tags: [], categoryId: 'bogus' }, 'category'))
      .toEqual({ categoryId: 'vervoer' });
  });

  it('fail-closed: null/unknown rung collapses to the coarse form, never the full item', () => {
    const offering = createDriver({ kind: 'offering', text: 'ik repareer fietsen', tags: ['fiets'] });
    expect(d.coarsen(offering, null)).toEqual({ categoryId: 'vervoer' });
    expect(d.coarsen(offering, 'nonsense')).toEqual({ categoryId: 'vervoer' });
    expect(d.coarsen(offering, 'full')).toBe(offering);    // only the finest rung releases the item
    // unmatched offering → { categoryId: null }, which reveals nothing
    expect(d.coarsen({ text: 'xyzzy', tags: [] }, 'category')).toEqual({ categoryId: null });
  });

  it('plugs into createVocabulary like any other descriptor', () => {
    const vocab = createVocabulary([d]);
    expect(vocab.type('offering')).toBe('driver');
    expect(vocab.ladder('offering')).toEqual(['category', 'full']);
    const offering = createDriver({ kind: 'offering', text: 'moestuin en snoeien', tags: [] });
    expect(vocab.coarsen('offering', offering, 'category')).toEqual({ categoryId: 'tuin' });
    expect(vocab.coarsen('offering', offering, 'full')).toBe(offering);
  });
});

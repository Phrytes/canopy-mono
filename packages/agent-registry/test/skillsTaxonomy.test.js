// Skills fold-in (NOTE-skills-properties-audit Q1/Q4) — the taxonomy as the COARSE rung of the
// `skill` property descriptor: deriveCategory (deterministic tag/keyword scoring) + the
// fail-closed coarsen (category rung drops text/tags, keeping only { categoryId }).
import { describe, it, expect } from 'vitest';
import {
  SKILLS_TAXONOMY, SKILL_LADDER, deriveCategory, skillDescriptor,
  createDriver, createVocabulary,
} from '../index.js';

describe('SKILLS_TAXONOMY (moved here from identity-resolver)', () => {
  it('exposes the fixed 10-category taxonomy with NL+EN labels, frozen', () => {
    expect(SKILLS_TAXONOMY.categories).toHaveLength(10);
    for (const c of SKILLS_TAXONOMY.categories) {
      expect(typeof c.id).toBe('string');
      expect(c.label.nl).toBeTruthy();
      expect(c.label.en).toBeTruthy();
    }
    expect(Object.isFrozen(SKILLS_TAXONOMY)).toBe(true);
  });

  it('SKILL_LADDER runs coarsest→finest per the vocabulary convention', () => {
    expect(SKILL_LADDER).toEqual(['category', 'full']);
  });
});

describe('deriveCategory — deterministic best-effort categoryId', () => {
  it('a tag equal to a category id wins outright', () => {
    expect(deriveCategory({ text: '', tags: ['vervoer'] })).toBe('vervoer');
    expect(deriveCategory({ tags: ['Tuin'] })).toBe('tuin');   // tags are normalised first
  });

  it('matches via label/hint keywords (NL + EN)', () => {
    expect(deriveCategory({ text: 'ik kan goed snoeien', tags: [] })).toBe('tuin');
    expect(deriveCategory({ text: 'babysitting on weekdays', tags: [] })).toBe('kinderopvang');
    expect(deriveCategory({ text: '', tags: ['belasting', 'formulieren'] })).toBe('administratie');
  });

  it('hyphenated tags match through their parts', () => {
    expect(deriveCategory({ tags: ['fietsreparatie-en-autohulp'] })).toBe('vervoer');
  });

  it('no evidence → null (never a guess)', () => {
    expect(deriveCategory({ text: 'zzz qqq', tags: ['xyzzy'] })).toBe(null);
    expect(deriveCategory({})).toBe(null);
    expect(deriveCategory(null)).toBe(null);
  });

  it('is deterministic: same input, same answer', () => {
    const item = { text: 'help with the computer and phone', tags: ['internet'] };
    expect(deriveCategory(item)).toBe('tech');
    expect(deriveCategory(item)).toBe(deriveCategory(item));
  });
});

describe('skillDescriptor — the skill rung of the vocabulary', () => {
  const d = skillDescriptor();

  it('registers as a driver-typed, sensitive descriptor with the category→full ladder', () => {
    expect(d.key).toBe('skill');
    expect(d.type).toBe('driver');
    expect(d.sensitivity).toBe('sensitive');
    expect(d.ladder).toEqual(['category', 'full']);
  });

  it('coarsen to category drops text+tags, keeping ONLY the derived { categoryId }', () => {
    const skill = createDriver({ kind: 'skill', text: 'ik repareer fietsen', tags: ['fiets'] });
    const coarse = d.coarsen(skill, 'category');
    expect(coarse).toEqual({ categoryId: 'vervoer' });
    expect(Object.keys(coarse)).toEqual(['categoryId']);   // no text/tags leak
  });

  it('a user-picked valid categoryId on the item wins over derivation', () => {
    const coarse = d.coarsen({ kind: 'skill', text: 'fietsen', tags: [], categoryId: 'anders' }, 'category');
    expect(coarse).toEqual({ categoryId: 'anders' });
    // an invalid pick is ignored → derived instead
    expect(d.coarsen({ text: 'fietsreparatie', tags: [], categoryId: 'bogus' }, 'category'))
      .toEqual({ categoryId: 'vervoer' });
  });

  it('fail-closed: null/unknown rung collapses to the coarse form, never the full item', () => {
    const skill = createDriver({ kind: 'skill', text: 'ik repareer fietsen', tags: ['fiets'] });
    expect(d.coarsen(skill, null)).toEqual({ categoryId: 'vervoer' });
    expect(d.coarsen(skill, 'nonsense')).toEqual({ categoryId: 'vervoer' });
    expect(d.coarsen(skill, 'full')).toBe(skill);          // only the finest rung releases the item
    // unmatched skill → { categoryId: null }, which reveals nothing
    expect(d.coarsen({ text: 'xyzzy', tags: [] }, 'category')).toEqual({ categoryId: null });
  });

  it('plugs into createVocabulary like any other descriptor', () => {
    const vocab = createVocabulary([d]);
    expect(vocab.type('skill')).toBe('driver');
    expect(vocab.ladder('skill')).toEqual(['category', 'full']);
    const skill = createDriver({ kind: 'skill', text: 'moestuin en snoeien', tags: [] });
    expect(vocab.coarsen('skill', skill, 'category')).toEqual({ categoryId: 'tuin' });
    expect(vocab.coarsen('skill', skill, 'full')).toBe(skill);
  });
});

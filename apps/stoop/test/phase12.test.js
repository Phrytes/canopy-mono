/**
 * Stoop V1 — Phase 12 tests.
 *
 * Skills taxonomy + tag-normalisation dictionary + Layer 1 matcher.
 * All pure functions; no agent / network setup needed.
 */

import { describe, it, expect } from 'vitest';
import {
  TAXONOMY,
  normaliseTag,
  categoryFor,
  matchesProfile,
  isKnownCategory,
} from '../src/lib/offeringsMatch.js';

// ── Taxonomy ──────────────────────────────────────────────────────────────

describe('Stoop V1 Phase 12 — taxonomy', () => {
  it('exposes 10 categories with NL+EN labels', () => {
    expect(TAXONOMY.categories).toHaveLength(10);
    for (const c of TAXONOMY.categories) {
      expect(typeof c.id).toBe('string');
      expect(c.label.nl).toBeTruthy();
      expect(c.label.en).toBeTruthy();
    }
  });

  it('isKnownCategory accepts taxonomy ids only', () => {
    expect(isKnownCategory('vervoer')).toBe(true);
    expect(isKnownCategory('klusjes')).toBe(true);
    expect(isKnownCategory('does-not-exist')).toBe(false);
  });
});

// ── Tag normalisation (Dutch + English) ───────────────────────────────────

describe('Stoop V1 Phase 12 — normaliseTag (multilingual)', () => {
  it('normalises Dutch fiets variants → bicycle', () => {
    expect(normaliseTag('fiets').tag).toBe('bicycle');
    expect(normaliseTag('fietsen').tag).toBe('bicycle');
    expect(normaliseTag('FIETS').tag).toBe('bicycle');
  });

  it('normalises English bicycle variants → bicycle', () => {
    expect(normaliseTag('bicycle').tag).toBe('bicycle');
    expect(normaliseTag('bike').tag).toBe('bicycle');
  });

  it('returns null for unknown / non-string input', () => {
    expect(normaliseTag('zhuangzi')).toBeNull();
    expect(normaliseTag('')).toBeNull();
    expect(normaliseTag(null)).toBeNull();
    expect(normaliseTag(123)).toBeNull();
  });

  it('every dictionary entry maps to a known category', () => {
    const ids = new Set(TAXONOMY.categories.map(c => c.id));
    // Walk a handful from the JSON to assert consistency.
    for (const term of ['fiets', 'belasting', 'oppassen', 'koken', 'naaien']) {
      const norm = normaliseTag(term);
      expect(ids.has(norm.category)).toBe(true);
    }
  });
});

// ── categoryFor (full-body suggestion) ────────────────────────────────────

describe('Stoop V1 Phase 12 — categoryFor', () => {
  it('suggests a category from a Dutch post body', () => {
    const r = categoryFor('Iemand handig met fietsen? Achterwiel slingert na een val.');
    expect(r.categoryId).toBe('vervoer');
    expect(r.tags).toContain('bicycle');
  });

  it('suggests a category from an English post body', () => {
    const r = categoryFor('Anyone good with a bicycle? My back wheel is wobbling.');
    expect(r.categoryId).toBe('vervoer');
    expect(r.tags).toContain('bicycle');
  });

  it('mixed-language body still works', () => {
    const r = categoryFor('Help met belasting + tax.');
    expect(r.categoryId).toBe('administratie');
    expect(r.tags).toContain('tax-admin');
  });

  it('returns category=null when no dictionary hits', () => {
    const r = categoryFor('lorem ipsum dolor');
    expect(r.categoryId).toBeNull();
    expect(r.tags).toEqual([]);
  });

  it('picks the most-counted category on a multi-category post', () => {
    // klusjes wins clearly: schilderen + verven + ladder = 3 hits.
    const r = categoryFor('Wie wil helpen met schilderen en verven? Ik heb een ladder.');
    expect(r.categoryId).toBe('klusjes');
    expect(r.tags).toEqual(expect.arrayContaining(['painting', 'ladder']));
  });
});

// ── matchesProfile (Layer 1 hit logic) ────────────────────────────────────

describe('Stoop V1 Phase 12 — matchesProfile', () => {
  const member = {
    skills: [
      { categoryId: 'vervoer', freeTags: ['bicycle', 'driving'], status: 'active' },
      { categoryId: 'tech',    freeTags: ['computer'],          status: 'active' },
      { categoryId: 'tuin',    freeTags: [],                    status: 'paused' },
    ],
  };

  it('hits via category match', () => {
    const r = matchesProfile({ categoryId: 'vervoer' }, member);
    expect(r.matched).toBe(true);
    expect(r.viaCategory).toBe('vervoer');
  });

  it('hits via tag overlap', () => {
    const r = matchesProfile({ tags: ['bicycle'] }, member);
    expect(r.matched).toBe(true);
    expect(r.viaTags).toContain('bicycle');
  });

  it('misses when neither category nor tags match', () => {
    const r = matchesProfile({ categoryId: 'kinderopvang', tags: ['babysitting'] }, member);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-overlap');
  });

  it('skips skills with status !== actief', () => {
    // The post is in tuin, but member's tuin skill is gepauzeerd.
    const r = matchesProfile({ categoryId: 'tuin' }, member);
    expect(r.matched).toBe(false);
  });

  it('returns no-active-skills when the member has none active', () => {
    const r = matchesProfile({ categoryId: 'vervoer' }, { skills: [] });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-active-skills');
  });

  // availability unification: 'away' IS holiday mode — skill-match routes
  // around a member whose unified availability is away, regardless of skills.
  it('routes AROUND a member whose availability is away', () => {
    const away = { ...member, availability: 'away' };
    const r = matchesProfile({ categoryId: 'vervoer' }, away);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('away');
  });

  it('still matches when availability is open/limited', () => {
    expect(matchesProfile({ categoryId: 'vervoer' }, { ...member, availability: 'open' }).matched).toBe(true);
    expect(matchesProfile({ categoryId: 'vervoer' }, { ...member, availability: 'limited' }).matched).toBe(true);
  });

  it('honours the legacy holidayMode flag for un-migrated entries', () => {
    const r = matchesProfile({ categoryId: 'vervoer' }, { ...member, holidayMode: true });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('away');
  });
});

// ── Cross-language matching end-to-end ────────────────────────────────────

describe('Stoop V1 Phase 12 — cross-language matching (Dutch post → English skill)', () => {
  it('a Dutch fietsen post matches a member with category vervoer + tag "bicycle"', () => {
    const post = categoryFor('iemand die m\'n fiets kan repareren');
    const member = {
      skills: [{ categoryId: 'vervoer', freeTags: ['bicycle'], status: 'active' }],
    };
    expect(matchesProfile(post, member).matched).toBe(true);
  });

  it('an English bicycle post matches a Dutch profile (vervoer + fiets-tags-normalised)', () => {
    const post = categoryFor('Need help with my bicycle');
    // The dictionary stores canonical 'bicycle' regardless of input language,
    // so a member who tagged themselves with 'bicycle' (English canonical)
    // matches a Dutch post about fietsen.  This is the multilingual win.
    const member = {
      skills: [{ categoryId: 'vervoer', freeTags: ['bicycle'], status: 'active' }],
    };
    expect(matchesProfile(post, member).matched).toBe(true);
  });
});

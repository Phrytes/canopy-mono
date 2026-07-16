/**
 * P6.M2 — view-as attribute split tests.
 */
import { describe, it, expect } from 'vitest';
import {
  isVisibleTo, splitViewAsAttributes, viewAsCounts, OPENNESS_LEVELS,
} from '../../src/v2/viewAsAttributes.js';

const PUBLIC   = { key: 'bio',     openness: 'public' };
const LOCALE   = { key: 'street',  openness: 'public-locale' };
const MEMBERS  = { key: 'phone',   openness: 'members' };
const CIRCLE   = { key: 'address', openness: 'circle-members' };
const PAIRW    = { key: 'realName', openness: 'pairwise' };
const FAMILY   = { key: 'tax-id',  openness: 'family' };
const PRIVATE  = { key: 'diary',   openness: 'private' };

describe('isVisibleTo', () => {
  it('public is visible to every viewer kind', () => {
    expect(isVisibleTo(PUBLIC, { kind: 'member'   })).toBe(true);
    expect(isVisibleTo(PUBLIC, { kind: 'agent'    })).toBe(true);
    expect(isVisibleTo(PUBLIC, { kind: 'stranger' })).toBe(true);
  });

  it('private is hidden from every viewer kind', () => {
    expect(isVisibleTo(PRIVATE, { kind: 'member'   })).toBe(false);
    expect(isVisibleTo(PRIVATE, { kind: 'agent'    })).toBe(false);
    expect(isVisibleTo(PRIVATE, { kind: 'stranger' })).toBe(false);
  });

  it('members tier: visible to members + agents (when they\'re fellow participants), hidden from strangers', () => {
    expect(isVisibleTo(MEMBERS, { kind: 'member'   })).toBe(true);
    expect(isVisibleTo(MEMBERS, { kind: 'stranger' })).toBe(false);
    // Agents are not "members" — by design they don't pass the members gate.
    expect(isVisibleTo(MEMBERS, { kind: 'agent'    })).toBe(false);
  });

  it('circle-members tier: passes only when the member shares THIS circle', () => {
    expect(isVisibleTo(CIRCLE, { kind: 'member', sharesCircle: true  })).toBe(true);
    expect(isVisibleTo(CIRCLE, { kind: 'member', sharesCircle: false })).toBe(false);
    expect(isVisibleTo(CIRCLE, { kind: 'stranger' })).toBe(false);
  });

  it('public-locale: members + agents always; strangers only when inMyLocale=true', () => {
    expect(isVisibleTo(LOCALE, { kind: 'stranger', inMyLocale: true  })).toBe(true);
    expect(isVisibleTo(LOCALE, { kind: 'stranger', inMyLocale: false })).toBe(false);
    expect(isVisibleTo(LOCALE, { kind: 'member' })).toBe(true);
    expect(isVisibleTo(LOCALE, { kind: 'agent'  })).toBe(true);
  });

  it('pairwise: only members with a revealedToMe entry for this key', () => {
    expect(isVisibleTo(PAIRW, { kind: 'member', revealedToMe: { realName: true } })).toBe(true);
    expect(isVisibleTo(PAIRW, { kind: 'member', revealedToMe: ['realName']        })).toBe(true);
    expect(isVisibleTo(PAIRW, { kind: 'member', revealedToMe: new Set(['realName']) })).toBe(true);
    expect(isVisibleTo(PAIRW, { kind: 'member', revealedToMe: { otherKey: true }   })).toBe(false);
    expect(isVisibleTo(PAIRW, { kind: 'stranger' })).toBe(false);
  });

  it("revealPolicy='open' on the active circle opens pairwise across all members", () => {
    expect(isVisibleTo(PAIRW, { kind: 'member' }, { policy: 'open' })).toBe(true);
    // But still requires the viewer be a member.
    expect(isVisibleTo(PAIRW, { kind: 'agent'    }, { policy: 'open' })).toBe(false);
    expect(isVisibleTo(PAIRW, { kind: 'stranger' }, { policy: 'open' })).toBe(false);
  });

  it('family tier: only when viewer.isFamily=true', () => {
    expect(isVisibleTo(FAMILY, { kind: 'member', isFamily: true  })).toBe(true);
    expect(isVisibleTo(FAMILY, { kind: 'member', isFamily: false })).toBe(false);
    expect(isVisibleTo(FAMILY, { kind: 'stranger', isFamily: true })).toBe(true);
  });

  it('unknown openness defaults to pairwise (safer)', () => {
    const unknown = { key: 'x', openness: 'bogus' };
    expect(isVisibleTo(unknown, { kind: 'member', revealedToMe: ['x'] })).toBe(true);
    expect(isVisibleTo(unknown, { kind: 'stranger' })).toBe(false);
  });

  it('missing attribute / viewer collapses to hidden (safe default)', () => {
    expect(isVisibleTo(null, { kind: 'member' })).toBe(false);
    expect(isVisibleTo({ openness: 'pairwise' /* no key */ }, { kind: 'member' })).toBe(false);
  });

  it('OPENNESS_LEVELS is the canonical ordering for renderers', () => {
    expect(OPENNESS_LEVELS).toEqual([
      'public', 'public-locale', 'members', 'circle-members',
      'pairwise', 'family', 'private',
    ]);
  });
});

describe('splitViewAsAttributes', () => {
  const myAttrs = [
    { key: 'bio',      label: 'Bio',       value: 'cyclist', openness: 'public' },
    { key: 'street',   label: 'Street',    value: 'Akkerstraat', openness: 'public-locale' },
    { key: 'realName', label: 'Real name', value: 'Bob',    openness: 'pairwise' },
    { key: 'tax-id',   label: 'Tax ID',    value: '123',    openness: 'family' },
    { key: 'diary',    label: 'Diary',     value: '...',    openness: 'private' },
  ];

  it('Sara-as-fellow-member sees public + members-tier + pairwise-revealed; hides family + private', () => {
    const split = splitViewAsAttributes({
      attributes: myAttrs,
      viewer: { kind: 'member', id: 'sara', sharesCircle: true, revealedToMe: ['realName'] },
    });
    expect(split.sees.map((a) => a.key).sort()).toEqual(['bio', 'realName', 'street']);
    expect(split.hides.map((a) => a.key).sort()).toEqual(['diary', 'tax-id']);
  });

  it('A stranger in my locale sees only public + public-locale', () => {
    const split = splitViewAsAttributes({
      attributes: myAttrs,
      viewer: { kind: 'stranger', inMyLocale: true },
    });
    expect(split.sees.map((a) => a.key).sort()).toEqual(['bio', 'street']);
  });

  it('An agent sees only public + public-locale (never private / family / pairwise)', () => {
    const split = splitViewAsAttributes({
      attributes: myAttrs,
      viewer: { kind: 'agent' },
    });
    expect(split.sees.map((a) => a.key).sort()).toEqual(['bio', 'street']);
    expect(split.hides.find((a) => a.key === 'realName')).toBeTruthy();
  });

  it('coerces unknown openness to "pairwise" + still hides from strangers', () => {
    const split = splitViewAsAttributes({
      attributes: [{ key: 'x', openness: 'yes-please' }],
      viewer: { kind: 'stranger' },
    });
    expect(split.sees).toEqual([]);
    expect(split.hides[0].openness).toBe('pairwise');
  });

  it('skips non-object entries in the input', () => {
    const split = splitViewAsAttributes({
      attributes: [null, undefined, 'noop', myAttrs[0]],
      viewer: { kind: 'stranger' },
    });
    expect(split.sees).toHaveLength(1);
  });
});

describe('viewAsCounts', () => {
  it('returns counts + total for a split', () => {
    expect(viewAsCounts({ sees: [{ key: 'a' }, { key: 'b' }], hides: [{ key: 'c' }] }))
      .toEqual({ visible: 2, hidden: 1, total: 3 });
  });
  it('tolerates missing / garbage input', () => {
    expect(viewAsCounts(null)).toEqual({ visible: 0, hidden: 0, total: 0 });
    expect(viewAsCounts({ sees: 'oops', hides: undefined })).toEqual({ visible: 0, hidden: 0, total: 0 });
  });
});

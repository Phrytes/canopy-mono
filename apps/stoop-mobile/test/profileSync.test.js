/**
 * profileSync — pure helper coverage for ProfileMineScreen / ProfileOtherScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  formatLocationLine, mergeSkillUpdate, removeSkill, avatarToUri, unpackProfile,
} from '../src/lib/profileSync.js';

describe('formatLocationLine', () => {
  it('renders "label (cell)" when label is present', () => {
    expect(formatLocationLine({ label: 'Oosterpoort', cell: 'A1' }))
      .toBe('Oosterpoort (A1)');
  });
  it('falls back to cell-only when no label', () => {
    expect(formatLocationLine({ cell: 'B2' })).toBe('B2');
  });
  it('returns null for empty / invalid', () => {
    expect(formatLocationLine(null)).toBeNull();
    expect(formatLocationLine({})).toBeNull();
    expect(formatLocationLine({ label: '' })).toBeNull();
  });
});

describe('mergeSkillUpdate', () => {
  it('appends a new categoryId', () => {
    const r = mergeSkillUpdate([], { categoryId: 'tuin' });
    expect(r).toHaveLength(1);
    expect(r[0].categoryId).toBe('tuin');
    expect(r[0].status).toBe('active');
  });
  it('replaces an existing categoryId', () => {
    const prev = [{ categoryId: 'tuin', status: 'active' }];
    const r = mergeSkillUpdate(prev, { categoryId: 'tuin', status: 'paused' });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('paused');
  });
  it('preserves other categories', () => {
    const prev = [{ categoryId: 'tuin' }, { categoryId: 'tech' }];
    const r = mergeSkillUpdate(prev, { categoryId: 'tuin', radius: 5 });
    expect(r.map((s) => s.categoryId).sort()).toEqual(['tech', 'tuin']);
    expect(r.find((s) => s.categoryId === 'tuin').radius).toBe(5);
  });
  it('ignores updates without categoryId', () => {
    const prev = [{ categoryId: 'tuin' }];
    expect(mergeSkillUpdate(prev, {})).toEqual(prev);
    expect(mergeSkillUpdate(prev, null)).toEqual(prev);
  });
});

describe('removeSkill', () => {
  it('drops the entry by categoryId', () => {
    const prev = [{ categoryId: 'tuin' }, { categoryId: 'tech' }];
    expect(removeSkill(prev, 'tuin')).toEqual([{ categoryId: 'tech' }]);
  });
  it('no-ops when categoryId absent', () => {
    const prev = [{ categoryId: 'tuin' }];
    expect(removeSkill(prev, 'klusjes')).toEqual(prev);
  });
  it('handles empty / null input', () => {
    expect(removeSkill([], 'x')).toEqual([]);
    expect(removeSkill(null, 'x')).toEqual([]);
  });
});

describe('avatarToUri', () => {
  it('builds a data URI from {mime, dataB64}', () => {
    expect(avatarToUri({ mime: 'image/jpeg', dataB64: 'AAA' }))
      .toBe('data:image/jpeg;base64,AAA');
  });
  it('passes strings through (e.g. mem:// URLs)', () => {
    expect(avatarToUri('mem://stoop/avatars/x.jpg')).toBe('mem://stoop/avatars/x.jpg');
  });
  it('returns null for empty / partial', () => {
    expect(avatarToUri(null)).toBeNull();
    expect(avatarToUri({})).toBeNull();
    expect(avatarToUri({ mime: 'image/jpeg' })).toBeNull();
  });
});

describe('unpackProfile', () => {
  it('extracts the canonical profile shape', () => {
    const r = unpackProfile({
      me: {
        handle: 'anne',
        displayName: 'Anne',
        avatarUrl: 'mem://x',
        skills: [{ categoryId: 'tuin' }],
        holidayMode: true,
        location: { cell: 'A1' },
      },
    });
    expect(r.handle).toBe('anne');
    expect(r.displayName).toBe('Anne');
    expect(r.avatarUri).toBe('mem://x');
    expect(r.skills).toHaveLength(1);
    expect(r.holidayMode).toBe(true);
    expect(r.location).toEqual({ cell: 'A1' });
  });
  it('accepts a flat shape too', () => {
    const r = unpackProfile({ handle: 'bob' });
    expect(r.handle).toBe('bob');
    expect(r.skills).toEqual([]);
    expect(r.holidayMode).toBe(false);
  });
  it('defaults sensibly for empty input', () => {
    const r = unpackProfile(null);
    expect(r.handle).toBeNull();
    expect(r.skills).toEqual([]);
    expect(r.holidayMode).toBe(false);
    expect(r.location).toBeNull();
  });
});

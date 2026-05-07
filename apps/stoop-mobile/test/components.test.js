/**
 * Components — pure-helper coverage for AvatarCircle's initials /
 * palette helpers and PostCard's attachment-uri / time-ago helpers.
 *
 * The visual JSX components themselves get render-level coverage in
 * the Phase 40.10.6 test pass once the JSX-in-JS transform is wired
 * for vitest. For now, the helpers live in `src/lib/{avatar,post}.js`
 * (re-exported by their components), so we test them directly.
 */

import { describe, it, expect } from 'vitest';
import { initials, paletteFor, PALETTE } from '../src/lib/avatar.js';
import { attachmentUri, timeAgo }        from '../src/lib/post.js';

describe('avatar.initials', () => {
  it('uses the first letters of up to two words', () => {
    expect(initials('Anne van Dijk')).toBe('AV');
    expect(initials('Anne')).toBe('A');
  });
  it('uppercases', () => {
    expect(initials('anne')).toBe('A');
  });
  it('handles trims + extra whitespace', () => {
    expect(initials('  Anne  van  Dijk ')).toBe('AV');
  });
  it('falls back to · for empty / invalid input', () => {
    expect(initials('')).toBe('·');
    expect(initials('   ')).toBe('·');
    expect(initials(null)).toBe('·');
    expect(initials(undefined)).toBe('·');
  });
});

describe('avatar.paletteFor', () => {
  it('returns one of the fixed palette colours', () => {
    expect(PALETTE).toContain(paletteFor('Anne'));
  });
  it('is deterministic', () => {
    expect(paletteFor('Anne')).toBe(paletteFor('Anne'));
  });
  it('different names usually map to different colours', () => {
    const seen = new Set();
    ['Anne', 'Bob', 'Cor', 'Dirk', 'Els', 'Frank', 'Greet', 'Hans']
      .forEach((n) => seen.add(paletteFor(n)));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('falls back on empty input', () => {
    expect(paletteFor('')).toBe(PALETTE[0]);
    expect(paletteFor(null)).toBe(PALETTE[0]);
  });
});

describe('post.attachmentUri', () => {
  it('passes through .uri', () => {
    expect(attachmentUri({ uri: 'file:///x.jpg' })).toBe('file:///x.jpg');
  });
  it('builds a data URL from .thumbnail.dataB64', () => {
    const u = attachmentUri({
      thumbnail: { mime: 'image/jpeg', dataB64: 'AAAA' },
    });
    expect(u).toBe('data:image/jpeg;base64,AAAA');
  });
  it('falls back to top-level dataB64', () => {
    const u = attachmentUri({ mime: 'image/png', dataB64: 'BBBB' });
    expect(u).toBe('data:image/png;base64,BBBB');
  });
  it('defaults mime to image/jpeg', () => {
    const u = attachmentUri({ thumbnail: { dataB64: 'CCCC' } });
    expect(u).toBe('data:image/jpeg;base64,CCCC');
  });
  it('returns null when nothing is renderable', () => {
    expect(attachmentUri(null)).toBeNull();
    expect(attachmentUri({})).toBeNull();
    expect(attachmentUri({ thumbnail: {} })).toBeNull();
  });
});

describe('post.timeAgo', () => {
  const T0 = 1_700_000_000_000;
  it('"now" for sub-minute', () => {
    expect(timeAgo(T0 - 30_000, T0)).toBe('now');
  });
  it('Xm for minutes', () => {
    expect(timeAgo(T0 - 5 * 60_000, T0)).toBe('5m');
  });
  it('Xh for hours', () => {
    expect(timeAgo(T0 - 3 * 3_600_000, T0)).toBe('3h');
  });
  it('Xd for days', () => {
    expect(timeAgo(T0 - 2 * 86_400_000, T0)).toBe('2d');
  });
  it('Xw for weeks', () => {
    expect(timeAgo(T0 - 14 * 86_400_000, T0)).toBe('2w');
  });
  it('null for invalid input', () => {
    expect(timeAgo(undefined)).toBeNull();
    expect(timeAgo(NaN)).toBeNull();
    expect(timeAgo('abc')).toBeNull();
    expect(timeAgo(T0 + 1000, T0)).toBeNull(); // future
  });
});

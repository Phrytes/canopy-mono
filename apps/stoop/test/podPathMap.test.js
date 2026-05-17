/**
 * podPathMap — Stoop mem://↔storage-function classifier.
 * Round-trips the spec rows + the colon-encoding regression
 * (`webid:local:<peer>` was the original 404 cause).
 */

import { describe, it, expect } from 'vitest';
import { classify, unclassify } from '../src/lib/podPathMap.js';

function roundtrip(mem, ctx) {
  const c = classify(mem, ctx);
  expect(c).not.toBeNull();
  expect(unclassify(c.storageFn, c.tail)).toBe(mem);
  return c;
}

describe('podPathMap.classify/unclassify', () => {
  it('offers/requests → group/<crew>/items (round-trips)', () => {
    const c = roundtrip('mem://neighborhood/items/01ABC.json', { crewId: 'C' });
    expect(c).toEqual({ storageFn: 'group/C/items', tail: '01ABC.json' });
  });

  it('roster member with colons → percent-encoded, round-trips (the original bug)', () => {
    const c = roundtrip('mem://neighborhood/members/webid:local:OVUaJV0', { crewId: 'C' });
    expect(c.storageFn).toBe('group/C/members');
    expect(c.tail).toBe('webid%3Alocal%3AOVUaJV0');   // no raw colons in the pod path
  });

  it('item attachments → group/<crew>/item-attachments (distinct from items)', () => {
    const c = roundtrip('mem://stoop/items/01X/attachments/a.jpg', { crewId: 'C' });
    expect(c.storageFn).toBe('group/C/item-attachments');
  });

  it('group governance → group/<crew>/governance', () => {
    const c = roundtrip('mem://neighborhood/groups/G1/config.json', { crewId: 'C' });
    expect(c.storageFn).toBe('group/C/governance');
  });

  it('threads → sharing/threads', () => {
    const c = roundtrip('mem://stoop/threads/t1.json');
    expect(c.storageFn).toBe('sharing/threads');
  });

  it('private plumbing (exact + prefix) → private/state with stoop/ sub-key', () => {
    expect(classify('mem://stoop/reveals.json')).toEqual({
      storageFn: 'private/state', tail: 'stoop/reveals.json',
    });
    expect(unclassify('private/state', 'stoop/reveals.json')).toBe('mem://stoop/reveals.json');
    roundtrip('mem://stoop/push-subscriptions.json');
    roundtrip('mem://stoop/interest-profile.json');
    roundtrip('mem://stoop/lists/abc.json');
    roundtrip('mem://stoop/avatars/alice.png');
  });

  it('returns null for out-of-scope / unroutable keys', () => {
    expect(classify('mem://stoop/settings/shared.json')).toBeNull();      // cross-app-settings.md owns these
    expect(classify('mem://stoop/settings/devices/d.json')).toBeNull();
    expect(classify('mem://neighborhood/weird/x')).toBeNull();
    expect(classify('not-a-mem-key')).toBeNull();
    // crew-scoped key but no active crew → skip (don't half-route)
    expect(classify('mem://neighborhood/items/1.json')).toBeNull();
    expect(classify('mem://neighborhood/items/1.json', {})).toBeNull();
  });

  it('unclassify rejects garbage', () => {
    expect(unclassify('group/C/unknown', 'x')).toBeNull();
    expect(unclassify(42, 'x')).toBeNull();
  });
});

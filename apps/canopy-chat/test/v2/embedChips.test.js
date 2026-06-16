/**
 * embedChips — normalize an item's cross-object embeds into display chips.
 */
import { describe, it, expect } from 'vitest';
import { embedChipsOf, shortRef, embedTypeLabelKey, EMBED_TYPE_ICON } from '../../src/v2/embedChips.js';

describe('embedChipsOf', () => {
  it('reads top-level embeds + maps type → icon, keeps a label', () => {
    const chips = embedChipsOf({ embeds: [
      { type: 'task', ref: 'urn:dec:item:T2', label: 'Anne onboarding' },
      { type: 'calendar-event', ref: 'evt-1' },
    ] });
    expect(chips).toEqual([
      { type: 'task', ref: 'urn:dec:item:T2', icon: '✅', label: 'Anne onboarding' },
      { type: 'calendar-event', ref: 'evt-1', icon: '📅', label: null },
    ]);
  });

  it('reads stoop-legacy source.embeds when there is no top-level embeds', () => {
    const chips = embedChipsOf({ source: { embeds: [{ type: 'request', ref: 'P-solar' }] } });
    expect(chips).toEqual([{ type: 'request', ref: 'P-solar', icon: '🙋', label: null }]);
  });

  it('falls back to 🔗 for an unknown type (forward-compatible)', () => {
    expect(embedChipsOf({ embeds: [{ type: 'gadget', ref: 'g1' }] })[0].icon).toBe('🔗');
  });

  it('drops malformed entries (missing type or ref) + handles no embeds', () => {
    expect(embedChipsOf({ embeds: [{ type: 'task' }, { ref: 'x' }, null, 'nope'] })).toEqual([]);
    expect(embedChipsOf({})).toEqual([]);
    expect(embedChipsOf(null)).toEqual([]);
  });

  it('trims a blank label to null', () => {
    expect(embedChipsOf({ embeds: [{ type: 'note', ref: 'n', label: '   ' }] })[0].label).toBeNull();
  });
});

describe('shortRef', () => {
  it('takes the last meaningful segment, strips .json, truncates', () => {
    expect(shortRef('urn:dec:item:T2')).toBe('T2');
    expect(shortRef('https://alice.pod/crews/c1/items/X.json')).toBe('X');
    expect(shortRef('pseudo-pod://alice-device/offers/abc')).toBe('abc');
    expect(shortRef('')).toBe('');
  });
});

describe('embedTypeLabelKey', () => {
  it('namespaces under circle.embed.type', () => {
    expect(embedTypeLabelKey('task')).toBe('circle.embed.type.task');
  });
  it('has icons for the canonical types', () => {
    expect(Object.keys(EMBED_TYPE_ICON)).toContain('task');
    expect(Object.keys(EMBED_TYPE_ICON)).toContain('calendar-event');
  });
});

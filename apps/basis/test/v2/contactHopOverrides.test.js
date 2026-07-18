/**
 * per-contact hop overrides tests.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeContactHopMode, effectiveHopMode, buildContactHopList,
  HOP_PER_CONTACT_MODES,
} from '../../src/v2/contactHopOverrides.js';

describe('normalizeContactHopMode', () => {
  it('passes enum values through', () => {
    expect(normalizeContactHopMode('always')).toBe('always');
    expect(normalizeContactHopMode('with-ok')).toBe('with-ok');
    expect(normalizeContactHopMode('off')).toBe('off');
  });
  it('maps boolean true/false to always/off (back-compat)', () => {
    expect(normalizeContactHopMode(true)).toBe('always');
    expect(normalizeContactHopMode(false)).toBe('off');
  });
  it('returns null for unrecognised input (fall back to global)', () => {
    expect(normalizeContactHopMode(null)).toBeNull();
    expect(normalizeContactHopMode(undefined)).toBeNull();
    expect(normalizeContactHopMode('maybe')).toBeNull();
    expect(normalizeContactHopMode(42)).toBeNull();
  });
  it('HOP_PER_CONTACT_MODES re-exports the enum', () => {
    expect(HOP_PER_CONTACT_MODES).toEqual(['always', 'with-ok', 'off']);
  });
});

describe('effectiveHopMode', () => {
  it('explicit per-contact wins over global', () => {
    expect(effectiveHopMode({ hopThrough: 'always' },  { global: 'off' })).toBe('always');
    expect(effectiveHopMode({ hopThrough: 'off' },     { global: 'always' })).toBe('off');
    expect(effectiveHopMode({ hopThrough: 'with-ok' }, { global: 'always' })).toBe('with-ok');
  });
  it('falls back to global stance when no per-contact value', () => {
    expect(effectiveHopMode({}, { global: 'always' })).toBe('always');
    expect(effectiveHopMode({}, { global: 'with-ok' })).toBe('with-ok');
    expect(effectiveHopMode({}, { global: 'off' })).toBe('off');
    expect(effectiveHopMode({})).toBe('off');                    // missing global → off
  });
  it('maps boolean global hop modes for back-compat', () => {
    expect(effectiveHopMode({}, { global: true })).toBe('with-ok'); // safer than always
    expect(effectiveHopMode({}, { global: false })).toBe('off');
  });
  it('per-contact boolean back-compat still applies', () => {
    expect(effectiveHopMode({ hopThrough: true  }, { global: 'off' })).toBe('always');
    expect(effectiveHopMode({ hopThrough: false }, { global: 'always' })).toBe('off');
  });
});

describe('buildContactHopList', () => {
  const hopMode = { global: 'with-ok' };

  it('emits a row per contact with the effective mode + isDefault flag', () => {
    const out = buildContactHopList({
      contacts: [
        { id: 'sjoerd', displayName: 'Sjoerd', hopThrough: 'always',  trustTier: 'vertrouwd' },
        { id: 'mira',   displayName: 'Mira'  /* default → global with-ok */ },
        { id: 'karin',  displayName: 'Karin',  hopThrough: 'off',     trustTier: 'verbonden' },
      ],
      hopMode,
    });
    expect(out).toEqual([
      { id: 'sjoerd', label: 'Sjoerd', mode: 'always',  trustTier: 'vertrouwd', isDefault: false },
      { id: 'mira',   label: 'Mira',   mode: 'with-ok', trustTier: null,        isDefault: true  },
      { id: 'karin',  label: 'Karin',  mode: 'off',     trustTier: 'verbonden', isDefault: false },
    ]);
  });

  it('sorts rows always → with-ok → off (board 7B order)', () => {
    const out = buildContactHopList({
      contacts: [
        { id: 'a', hopThrough: 'off' },
        { id: 'b', hopThrough: 'always' },
        { id: 'c', hopThrough: 'with-ok' },
      ],
      hopMode: { global: 'off' },
    });
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('picks the best available label + falls back to id/webid', () => {
    const out = buildContactHopList({
      contacts: [
        { id: 'a',                       hopThrough: 'off' },
        { webid: 'webid:b',              hopThrough: 'off' },
        {                                hopThrough: 'off' /* truly anonymous */ },
      ],
      hopMode,
    });
    expect(out.map((r) => r.label)).toEqual(['a', 'webid:b', '(unknown)']);
  });

  it('drops non-object contacts gracefully', () => {
    const out = buildContactHopList({
      contacts: [null, undefined, 'string-not-a-contact', { id: 'real', hopThrough: 'off' }],
      hopMode,
    });
    expect(out.map((r) => r.id)).toEqual(['real']);
  });

  it('respects boolean back-compat in the contact list (hopThrough: true → always)', () => {
    const out = buildContactHopList({
      contacts: [
        { id: 'old', hopThrough: true },
        { id: 'new', hopThrough: 'always' },
      ],
      hopMode: { global: 'off' },
    });
    expect(out.map((r) => r.mode)).toEqual(['always', 'always']);
    expect(out[0].isDefault).toBe(false);
    expect(out[1].isDefault).toBe(false);
  });
});

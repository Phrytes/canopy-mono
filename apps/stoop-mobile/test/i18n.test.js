/**
 * i18n tests — locale-resolver behaviour with the real
 * `apps/stoop/locales/{en,nl}.json` files.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initI18n, setLang, currentLang, t, format, _internal, isInitialised } from '../src/lib/i18n.js';

beforeEach(async () => {
  await setLang('en');
});

describe('i18n — initialisation', () => {
  it('defaults to English when no lng is given', async () => {
    await initI18n();
    expect(currentLang()).toBe('en');
    expect(isInitialised()).toBe(true);
  });

  it('switches to Dutch when asked', async () => {
    await initI18n({ lng: 'nl' });
    expect(currentLang()).toBe('nl');
  });

  it('falls back to English on unknown language', async () => {
    await setLang('zh');
    expect(currentLang()).toBe('en');
  });
});

describe('i18n — t() lookups', () => {
  it('resolves a known mobile.* key in English', () => {
    expect(t('mobile.scan_qr')).toBe('Scan QR');
  });

  it('resolves the same key in Dutch', async () => {
    await setLang('nl');
    const v = t('mobile.scan_qr');
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
    // Dutch translation might equal English here; check the key
    // exists in the bundle either way.
    expect(_internal._lookupKey(_internal.BUNDLES.nl, 'mobile.scan_qr')).toBeTruthy();
  });

  it('returns the fallback when the key is missing', () => {
    expect(t('nope.nope', 'fallback')).toBe('fallback');
  });

  it('returns the key itself when there is no fallback', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('unwraps {text, doc} leaves', () => {
    // chat.attach_picture is {text, doc} in the real bundle.
    const v = t('chat.attach_picture');
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('i18n — format()', () => {
  it('substitutes {param} placeholders', () => {
    // Use a literal key with manual fallback for predictability.
    const out = format('does.not.exist', { name: 'Anne' }, 'Hello {name}');
    expect(out).toBe('Hello Anne');
  });

  it('substitutes multiple params', () => {
    const out = format('does.not.exist', { a: 1, b: 2 }, '{a} + {b}');
    expect(out).toBe('1 + 2');
  });

  it('leaves unmatched placeholders intact', () => {
    const out = format('does.not.exist', { a: 1 }, '{a} + {b}');
    expect(out).toBe('1 + {b}');
  });

  it('coerces non-string values', () => {
    const out = format('does.not.exist', { n: 42 }, 'count={n}');
    expect(out).toBe('count=42');
  });
});

describe('_internal._lookupKey', () => {
  const bundle = {
    a: { b: { c: 'plain-string' } },
    obj: { key: { text: 'unwrapped', doc: 'descriptor' } },
    legacy: 'top-level-string',
    notext: { foo: 'bar' },
  };

  it('walks dotted paths', () => {
    expect(_internal._lookupKey(bundle, 'a.b.c')).toBe('plain-string');
  });

  it('unwraps {text} leaves', () => {
    expect(_internal._lookupKey(bundle, 'obj.key')).toBe('unwrapped');
  });

  it('returns top-level strings', () => {
    expect(_internal._lookupKey(bundle, 'legacy')).toBe('top-level-string');
  });

  it('returns undefined when the key misses', () => {
    expect(_internal._lookupKey(bundle, 'a.x')).toBeUndefined();
    expect(_internal._lookupKey(bundle, 'q.r')).toBeUndefined();
  });

  it('returns undefined for non-{text} object leaves', () => {
    expect(_internal._lookupKey(bundle, 'notext')).toBeUndefined();
  });

  it('rejects non-string keys', () => {
    expect(_internal._lookupKey(bundle, null)).toBeUndefined();
    expect(_internal._lookupKey(bundle, 42)).toBeUndefined();
  });

  it('rejects null bundle', () => {
    expect(_internal._lookupKey(null, 'a.b')).toBeUndefined();
  });
});

/**
 * Theme-context resolve logic (mobile) — the display-theme preference decision
 * (systeem / licht / donker → the concrete light|dark theme) is a PURE function
 * shared web ↔ mobile (apps/basis/src/v2/themePref.js), so we cover it off-RN in
 * the portable-vitest cadence. The RN provider (themeContext.js) wires this to
 * useColorScheme + the AsyncStorage pref store; the resolve itself is tested here.
 *
 * Also asserts the display-theme locale keys the toggle reuses resolve in both
 * languages (no new keys — same shared circle.mydata.theme(_system/_light/_dark)
 * the web pass added), keeping web ≡ mobile.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeThemePref, resolveThemeName, DEFAULT_THEME_PREF, THEME_PREF_KEY,
  createThemePrefStore, sharedCircleLocale,
} from '@onderling-app/basis';

describe('themePref — normalizeThemePref', () => {
  it('passes known preferences through', () => {
    expect(normalizeThemePref('system')).toBe('system');
    expect(normalizeThemePref('light')).toBe('light');
    expect(normalizeThemePref('dark')).toBe('dark');
  });
  it('falls back to the default for unknown / empty values', () => {
    expect(normalizeThemePref('donker')).toBe(DEFAULT_THEME_PREF);
    expect(normalizeThemePref(undefined)).toBe('system');
    expect(normalizeThemePref(null)).toBe('system');
    expect(normalizeThemePref('')).toBe('system');
  });
});

describe('themePref — resolveThemeName (systeem/licht/donker → light|dark)', () => {
  it('an explicit light/dark override wins over the OS scheme', () => {
    expect(resolveThemeName('light', 'dark')).toBe('light');
    expect(resolveThemeName('dark', 'light')).toBe('dark');
    expect(resolveThemeName('light', 'light')).toBe('light');
    expect(resolveThemeName('dark', 'dark')).toBe('dark');
  });
  it('systeem follows the live OS scheme', () => {
    expect(resolveThemeName('system', 'dark')).toBe('dark');
    expect(resolveThemeName('system', 'light')).toBe('light');
  });
  it('systeem with no/unknown OS scheme resolves to light', () => {
    expect(resolveThemeName('system', null)).toBe('light');
    expect(resolveThemeName('system', undefined)).toBe('light');
  });
  it('an unknown preference is treated as systeem', () => {
    expect(resolveThemeName('bogus', 'dark')).toBe('dark');
    expect(resolveThemeName('bogus', 'light')).toBe('light');
  });
});

describe('themePref — store', () => {
  it('defaults to system, hydrates + persists through an injected io', async () => {
    let backing = null;
    const io = { get: async () => backing, set: async (v) => { backing = v; } };
    const store = createThemePrefStore(io);
    expect(store.get()).toBe('system');           // cached default before hydrate
    await store.set('dark');
    expect(store.get()).toBe('dark');
    expect(backing).toBe('dark');
    const fresh = createThemePrefStore(io);
    expect(await fresh.hydrate()).toBe('dark');    // reads the persisted value back
  });
  it('exposes the shared storage key (web ≡ mobile contract)', () => {
    expect(THEME_PREF_KEY).toBe('basis.theme');
  });
});

describe('themePref — display-theme locale keys (shared, web ≡ mobile)', () => {
  for (const lang of ['en', 'nl']) {
    it(`resolves circle.mydata.theme(_system/_light/_dark) in ${lang}`, () => {
      const mydata = sharedCircleLocale[lang]?.mydata ?? {};
      for (const k of ['theme', 'theme_system', 'theme_light', 'theme_dark']) {
        const node = mydata[k];
        const text = typeof node === 'object' ? node.text : node;
        expect(text, `${lang}.circle.mydata.${k}`).toBeTruthy();
      }
    });
  }
});

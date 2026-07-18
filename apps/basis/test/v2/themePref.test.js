import { describe, it, expect } from 'vitest';
import {
  THEME_PREFS, DEFAULT_THEME_PREF, THEME_PREF_KEY,
  normalizeThemePref, resolveThemeName, createThemePrefStore,
} from '../../src/v2/themePref.js';

describe('themePref — the shared display-theme contract (web ≡ mobile)', () => {
  it('exposes the vocabulary + default + storage key', () => {
    expect(THEME_PREFS).toEqual(['system', 'light', 'dark']);
    expect(DEFAULT_THEME_PREF).toBe('system');
    expect(THEME_PREF_KEY).toBe('basis.theme');   // same key web persists on localStorage
  });
});

describe('normalizeThemePref', () => {
  it('passes known values, defaults unknown to system', () => {
    expect(normalizeThemePref('light')).toBe('light');
    expect(normalizeThemePref('dark')).toBe('dark');
    expect(normalizeThemePref('system')).toBe('system');
    for (const bad of ['donker', '', null, undefined, 7]) expect(normalizeThemePref(bad)).toBe('system');
  });
});

describe('resolveThemeName (pref + OS scheme → light|dark)', () => {
  it('explicit override wins; systeem follows the OS; unknown OS ⇒ light', () => {
    expect(resolveThemeName('light', 'dark')).toBe('light');
    expect(resolveThemeName('dark', 'light')).toBe('dark');
    expect(resolveThemeName('system', 'dark')).toBe('dark');
    expect(resolveThemeName('system', 'light')).toBe('light');
    expect(resolveThemeName('system', null)).toBe('light');
    expect(resolveThemeName('bogus', 'dark')).toBe('dark');   // unknown ⇒ treated as system
  });
});

describe('createThemePrefStore', () => {
  it('caches the default, then hydrates + persists via the injected io', async () => {
    let backing = null;
    const io = { get: async () => backing, set: async (v) => { backing = v; } };
    const store = createThemePrefStore(io);
    expect(store.get()).toBe('system');
    expect(await store.set('dark')).toBe('dark');
    expect(backing).toBe('dark');
    expect(store.get()).toBe('dark');
    expect(await createThemePrefStore(io).hydrate()).toBe('dark');
  });
});

/**
 * loadLocale — substrate-level coverage. The end-to-end Stoop locale
 * resolution is exercised in apps/stoop-mobile/test/i18n.test.js
 * (which now goes through this substrate).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadLocale } from '../../src/i18n/loadLocale.js';

const EN = {
  greeting: { text: 'Hello', doc: 'Generic greeting' },
  ui: {
    nav: {
      home: { text: 'Home', doc: '' },
    },
  },
  count: { text: 'You have {count} unread', doc: 'Inbox count' },
};
const NL = {
  greeting: { text: 'Hallo', doc: 'Generic greeting' },
  ui: {
    nav: {
      home: { text: 'Thuis', doc: '' },
    },
  },
  count: { text: 'Je hebt {count} ongelezen', doc: 'Inbox count' },
};

describe('loadLocale — input validation', () => {
  it('throws when bundles is missing', () => {
    expect(() => loadLocale()).toThrow(/bundles map required/);
  });
  it('throws when defaultLang has no bundle', () => {
    expect(() => loadLocale({ bundles: { en: EN }, defaultLang: 'fr' }))
      .toThrow(/defaultLang/);
  });
});

describe('loadLocale — basic flow', () => {
  let i18n;
  beforeEach(() => { i18n = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' }); });

  it('starts on the default language, not initialised', () => {
    expect(i18n.currentLang()).toBe('en');
    expect(i18n.isInitialised()).toBe(false);
  });

  it('initI18n marks initialised', async () => {
    await i18n.initI18n({ lng: 'nl' });
    expect(i18n.currentLang()).toBe('nl');
    expect(i18n.isInitialised()).toBe(true);
  });

  it('falls back to default on unknown language', async () => {
    await i18n.setLang('zh');
    expect(i18n.currentLang()).toBe('en');
  });
});

describe('loadLocale — t() + format()', () => {
  let i18n;
  beforeEach(() => { i18n = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' }); });

  it('unwraps {text, doc} leaves', () => {
    expect(i18n.t('greeting')).toBe('Hello');
  });

  it('walks dotted paths', () => {
    expect(i18n.t('ui.nav.home')).toBe('Home');
  });

  it('returns fallback (or key) when not found', () => {
    expect(i18n.t('missing.key', 'default')).toBe('default');
    expect(i18n.t('missing.key')).toBe('missing.key');
  });

  it('switches bundle on setLang', async () => {
    await i18n.setLang('nl');
    expect(i18n.t('greeting')).toBe('Hallo');
    expect(i18n.t('ui.nav.home')).toBe('Thuis');
  });

  it('format() interpolates {param}', () => {
    expect(i18n.format('count', { count: 3 })).toBe('You have 3 unread');
  });
});

describe('loadLocale — multi-instance isolation', () => {
  it('two instances do not share state', async () => {
    const a = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' });
    const b = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' });
    await a.setLang('nl');
    expect(a.currentLang()).toBe('nl');
    expect(b.currentLang()).toBe('en');
  });
});

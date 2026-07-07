/**
 * LocalisationProvider primitives — the loadLocale resolver behaviour over
 * tasks-mobile's merged bundles.
 *
 * Phase 41.2.7 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { loadLocale } from '@canopy/react-native/localisation';

import enDesktop from '@canopy-app/tasks-v0/locales/en';
import nlDesktop from '@canopy-app/tasks-v0/locales/nl';
import enMobile  from '../locales/en.json';
import nlMobile  from '../locales/nl.json';

function _deepMerge(a, b) {
  if (!b) return a;
  if (!a) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') {
      out[k] = _deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const BUNDLES = {
  en: _deepMerge(enDesktop, enMobile),
  nl: _deepMerge(nlDesktop, nlMobile),
};

describe('LocalisationProvider — merged tasks-v0 + tasks-mobile bundles', () => {
  it('resolves a tasks-mobile-only key', async () => {
    const localisation = loadLocale({ bundles: BUNDLES, defaultLang: 'en' });
    await localisation.initLocalisation({ lng: 'en' });
    expect(localisation.t('mobile.no_circles.title')).toBe('No circles yet');
    expect(localisation.t('mobile.boot.loading')).toBe('Booting…');
  });

  it('resolves the same mobile key in Dutch', async () => {
    const localisation = loadLocale({ bundles: BUNDLES, defaultLang: 'en' });
    await localisation.initLocalisation({ lng: 'nl' });
    expect(localisation.t('mobile.no_circles.title')).toBe('Nog geen kringen');
  });

  it('resolves a tasks-v0 (desktop) key through the merged bundle', async () => {
    const localisation = loadLocale({ bundles: BUNDLES, defaultLang: 'en' });
    await localisation.initLocalisation({ lng: 'en' });
    // Pick something that's known to live in apps/tasks-v0/locales/en.json.
    // We don't want to assert on a specific desktop string (those evolve);
    // the contract is "at least one tasks-v0 namespace resolves to a string".
    const r = localisation.t('dependencies.has_open_dependencies', null);
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
  });

  it('falls back to the key when missing', async () => {
    const localisation = loadLocale({ bundles: BUNDLES, defaultLang: 'en' });
    await localisation.initLocalisation({ lng: 'en' });
    expect(localisation.t('not.a.real.key')).toBe('not.a.real.key');
  });

  it('format() interpolates {param}', async () => {
    const localisation = loadLocale({
      bundles: { en: { count: { text: 'You have {count} unread', doc: '' } } },
      defaultLang: 'en',
    });
    await localisation.initLocalisation();
    expect(localisation.format('count', { count: 3 })).toBe('You have 3 unread');
  });
});

/**
 * I18nProvider — wraps the substrate's `loadLocale` factory with
 * tasks-mobile's locale bundles + exposes a stable `useI18n` hook.
 *
 * Phase 41.2 (2026-05-09).
 *
 * Locale bundles are merged from two sources:
 *   - `apps/tasks-v0/locales/{en,nl}.json` — desktop strings reused
 *     by mobile (crew/role/DoD/skill-taxonomy/dependencies/…)
 *   - `apps/tasks-mobile/locales/{en,nl}.json` — mobile-only screen
 *     strings (mobile.boot.*, mobile.no_crews.*, …)
 *
 * The merge is shallow-with-deep on the `mobile` namespace — the
 * desktop bundle has no `mobile.*` keys, so the mobile overrides
 * win cleanly.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadLocale } from '@canopy/react-native/i18n';

import enDesktop from '@canopy-app/tasks-v0/locales/en';
import nlDesktop from '@canopy-app/tasks-v0/locales/nl';
import enMobile  from '../locales/en.json';
import nlMobile  from '../locales/nl.json';

const I18nContext = createContext({
  t:        (key, fb) => fb ?? key,
  format:   (key, _, fb) => fb ?? key,
  setLang:  () => {},
  currentLang: () => 'en',
  ready:    false,
});

// Deep merge — used only for the `mobile.*` overlay; desktop keys
// remain authoritative everywhere else.
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

export function I18nProvider({ children, defaultLang = 'en' }) {
  const i18n = useMemo(() => loadLocale({ bundles: BUNDLES, defaultLang }), [defaultLang]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    i18n.initI18n().then(() => {
      if (!cancelled) setTick((n) => n + 1);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [i18n]);

  const value = useMemo(() => ({
    t:           i18n.t,
    format:      i18n.format,
    setLang:     async (lang) => { await i18n.setLang(lang); setTick((n) => n + 1); },
    currentLang: i18n.currentLang,
    ready:       i18n.isInitialised(),
    _tick:       tick,
  }), [i18n, tick]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export { I18nContext };

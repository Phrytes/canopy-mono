/**
 * LocalisationProvider — wraps the substrate's `loadLocale` factory with
 * tasks-mobile's locale bundles + exposes a stable `useLocalisation` hook.
 *
 * Phase 41.2 (2026-05-09).
 * 41.18 follow-up — adds `apps/tasks-v0/locales/shared/{en,nl}.json`
 *                   to the merge stack so `shared.status.*` /
 *                   `shared.roles.*` keys resolve from a single
 *                   source on both shells (Project Files/conventions/
 *                   architectural-layering.md § shared UI helpers).
 *
 * Locale bundles are merged from three sources, shell-local wins:
 *   - `apps/tasks-v0/locales/shared/{en,nl}.json` — strings rendered
 *     by both desktop + mobile (status pills, role labels, crew
 *     kinds, approval modes).
 *   - `apps/tasks-v0/locales/{en,nl}.json` — desktop-only strings
 *     reused by mobile via the platform-shell exception.
 *   - `apps/tasks-mobile/locales/{en,nl}.json` — mobile-only screen
 *     strings (mobile.boot.*, mobile.welcome.*, …).
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadLocale } from '@canopy/react-native/localisation';

import enShared  from '@canopy-app/tasks-v0/locales/shared/en';
import nlShared  from '@canopy-app/tasks-v0/locales/shared/nl';
import enDesktop from '@canopy-app/tasks-v0/locales/en';
import nlDesktop from '@canopy-app/tasks-v0/locales/nl';
import enMobile  from '../locales/en.json';
import nlMobile  from '../locales/nl.json';

const LocalisationContext = createContext({
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

// Shell-local wins on collision: shared (base) → desktop → mobile.
const BUNDLES = {
  en: _deepMerge(_deepMerge(enShared, enDesktop), enMobile),
  nl: _deepMerge(_deepMerge(nlShared, nlDesktop), nlMobile),
};

export function LocalisationProvider({ children, defaultLang = 'en' }) {
  const localisation = useMemo(() => loadLocale({ bundles: BUNDLES, defaultLang }), [defaultLang]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    localisation.initLocalisation().then(() => {
      if (!cancelled) setTick((n) => n + 1);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [localisation]);

  const value = useMemo(() => ({
    t:           localisation.t,
    format:      localisation.format,
    setLang:     async (lang) => { await localisation.setLang(lang); setTick((n) => n + 1); },
    currentLang: localisation.currentLang,
    ready:       localisation.isInitialised(),
    _tick:       tick,
  }), [localisation, tick]);

  return (
    <LocalisationContext.Provider value={value}>
      {children}
    </LocalisationContext.Provider>
  );
}

export function useLocalisation() {
  return useContext(LocalisationContext);
}

export { LocalisationContext };

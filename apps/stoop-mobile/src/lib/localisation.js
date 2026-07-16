/**
 * localisation — Stoop's locale resolver, bound to apps/stoop/locales/{en,nl}.json.
 *
 * The generic resolver lives in `@onderling/react-native/localisation` (lifted
 * 2026-05-09 — Phase 41.0 L7). Stoop instantiates it once and re-exports
 * the same module-level API existing call sites use.
 */

import en from '@onderling-app/stoop/locales/en';
import nl from '@onderling-app/stoop/locales/nl';
import { loadLocale } from '@onderling/react-native/localisation';

const _localisation = loadLocale({ bundles: { en, nl }, defaultLang: 'en' });

export const initLocalisation        = _localisation.initLocalisation;
export const detectDeviceLang = _localisation.detectDeviceLang;
export const setLang         = _localisation.setLang;
export const currentLang     = _localisation.currentLang;
export const isInitialised   = _localisation.isInitialised;
export const t               = _localisation.t;
export const format          = _localisation.format;

export const _internal = {
  ..._localisation._internal,
  BUNDLES: { en, nl },
};

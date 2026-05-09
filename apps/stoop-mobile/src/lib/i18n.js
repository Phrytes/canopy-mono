/**
 * i18n — Stoop's locale resolver, bound to apps/stoop/locales/{en,nl}.json.
 *
 * The generic resolver lives in `@canopy/react-native/i18n` (lifted
 * 2026-05-09 — Phase 41.0 L7). Stoop instantiates it once and re-exports
 * the same module-level API existing call sites use.
 */

import en from '@canopy-app/stoop/locales/en';
import nl from '@canopy-app/stoop/locales/nl';
import { loadLocale } from '@canopy/react-native/i18n';

const _i18n = loadLocale({ bundles: { en, nl }, defaultLang: 'en' });

export const initI18n        = _i18n.initI18n;
export const detectDeviceLang = _i18n.detectDeviceLang;
export const setLang         = _i18n.setLang;
export const currentLang     = _i18n.currentLang;
export const isInitialised   = _i18n.isInitialised;
export const t               = _i18n.t;
export const format          = _i18n.format;

export const _internal = {
  ..._i18n._internal,
  BUNDLES: { en, nl },
};

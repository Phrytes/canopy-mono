/**
 * i18n — RN-friendly locale resolver for Stoop V3 mobile.
 *
 * Stoop V3 Phase 40.10 (2026-05-08).
 *
 * Reuses `apps/stoop/locales/{nl,en}.json` byte-for-byte (same keys,
 * same `{text, doc}` leaves). The desktop app pulls i18next; mobile
 * doesn't — RN bundlers ship JSON imports cleanly and we only need
 * dotted-path lookup + leaf-unwrap. This module is a copy of
 * `apps/stoop/web/app.js`'s `_lookupKey` + `t` flow, lifted into a
 * stand-alone module.
 *
 * Usage:
 *
 *   import { initI18n, t, setLang, currentLang } from './lib/i18n.js';
 *   await initI18n({ lng: 'nl' });
 *   <Text>{t('mobile.scan_qr')}</Text>
 *
 * Init is synchronous-friendly (the JSON imports are static); the
 * promise interface keeps parity with the web wrapper for readers
 * jumping between codebases.
 */

import en from '@canopy-app/stoop/locales/en';
import nl from '@canopy-app/stoop/locales/nl';

const DEFAULT_LANG = 'en';
const BUNDLES      = { en, nl };

let _bundle = en;
let _lang   = DEFAULT_LANG;
let _initialised = false;

/**
 * @param {object} [opts]
 * @param {'en'|'nl'} [opts.lng]   when omitted, auto-detects from
 *   the device locale (Dutch → 'nl', everything else → 'en').
 * @returns {Promise<void>}  resolves when the locale switch completes
 */
export async function initI18n({ lng } = {}) {
  await setLang(lng ?? detectDeviceLang());
  _initialised = true;
}

/**
 * Best-effort detect the device's preferred Stoop locale.
 *   - Returns `'nl'` when the system locale starts with `nl-`.
 *   - Returns `'en'` otherwise.
 *
 * Uses pure-JS `Intl` (always present on Hermes / RN ≥ 0.71). No
 * native module, no `expo-localization` dep.
 */
export function detectDeviceLang() {
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (typeof tag === 'string' && tag.toLowerCase().startsWith('nl')) return 'nl';
  } catch { /* fall through */ }
  return DEFAULT_LANG;
}

export async function setLang(lang) {
  const next = BUNDLES[lang];
  if (!next) {
    // Unknown language — fall back to English rather than throwing,
    // matching i18next's `fallbackLng` behaviour. The desktop app
    // ships the same expectation.
    _lang   = DEFAULT_LANG;
    _bundle = BUNDLES[DEFAULT_LANG];
    return;
  }
  _lang   = lang;
  _bundle = next;
}

export function currentLang() {
  return _lang;
}

export function isInitialised() {
  return _initialised;
}

/**
 * Translate `key` to the loaded locale. Returns `fallback` (or the
 * key itself) when the lookup misses or i18n hasn't been initialised
 * yet.
 *
 * @param {string} key      dotted path (e.g. `'mobile.scan_qr'`)
 * @param {string} [fallback]
 * @returns {string}
 */
export function t(key, fallback) {
  const hit = _lookupKey(_bundle, key);
  if (typeof hit === 'string') return hit;
  return fallback ?? key;
}

/**
 * Same as `t` but with `{name}` interpolation. Use when you'd
 * otherwise template a string by hand.
 *
 *   t.format('chat.unread', { count: 3 }) → "3 unread"
 *
 * Note: kept simple — `{key}` becomes `params.key`. No nested or
 * complex transforms.
 */
export function format(key, params, fallback) {
  let s = t(key, fallback);
  if (!params) return s;
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return s;
}

/**
 * Internal: walk a dotted key + unwrap `{text, doc}` leaves.
 * @param {object} bundle
 * @param {string} key
 * @returns {string|undefined}
 */
function _lookupKey(bundle, key) {
  if (!bundle || typeof key !== 'string') return undefined;
  let cur = bundle;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return undefined;
  }
  if (typeof cur === 'string') return cur;
  if (cur && typeof cur === 'object' && typeof cur.text === 'string') return cur.text;
  return undefined;
}

export const _internal = {
  _lookupKey,
  BUNDLES,
};

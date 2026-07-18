/**
 * Localisation for basis-mobile.  Portable wrapper around
 * i18next that unwraps the project's `{text, doc}` leaf shape and
 * exposes a `t()` that future RN screens call.
 *
 * Convention enforced from day 1: every user-facing string
 * goes through `t()` with a locale entry; hardcoded English is a
 * defect.  Mirrors apps/tasks-v0/src/lib/localisation.js + the
 * stoop-mobile equivalent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '../../locales/en.json';
import nl from '../../locales/nl.json';
// The shared `circle`/`consequence`/`role` blocks live in ONE place in the basis package
// (src/locales/) so web + mobile can't drift; merge them over the mobile-only keys below.
import { sharedCircleLocale, sharedConsequenceLocale, sharedRoleLocale } from '@onderling-app/basis';

function unwrapLeaves(node) {
  if (node === null || typeof node !== 'object') return node;
  if (typeof node.text === 'string'
      && (node.doc === undefined || typeof node.doc === 'string')
      && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
    return node.text;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = unwrapLeaves(v);
  return out;
}

const BUNDLES = {
  en: unwrapLeaves({ ...en, circle: sharedCircleLocale.en, consequence: sharedConsequenceLocale.en, role: sharedRoleLocale.en }),
  nl: unwrapLeaves({ ...nl, circle: sharedCircleLocale.nl, consequence: sharedConsequenceLocale.nl, role: sharedRoleLocale.nl }),
};

let currentLang = 'en';

function lookup(bundle, dottedKey) {
  let cur = bundle;
  for (const seg of dottedKey.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] ?? `{{${k}}}`));
}

const LANG_KEY = 'circle.app.lang';
const _langListeners = new Set();
/** Subscribe to app-language changes (App.js re-renders the tree). Returns an unsubscribe fn. */
export function subscribeLang(cb) { _langListeners.add(cb); return () => _langListeners.delete(cb); }
function _notifyLang() { for (const cb of _langListeners) { try { cb(currentLang); } catch { /* ignore */ } } }

export async function initLocalisation({ lng } = {}) {
  // A persisted user choice (the Mij toggle) wins over the passed device locale.
  let stored = null; try { stored = await AsyncStorage.getItem(LANG_KEY); } catch { /* no storage */ }
  if (stored === 'en' || stored === 'nl') currentLang = stored;
  else if (lng === 'en' || lng === 'nl') currentLang = lng;
  return currentLang;
}

export function setLang(lng) {
  if (lng === 'en' || lng === 'nl') {
    currentLang = lng;
    AsyncStorage.setItem(LANG_KEY, lng).catch(() => { /* best-effort */ });
    _notifyLang();
  }
  return currentLang;
}

export function lang() { return currentLang; }

/** Translate a key.  Falls back to the key string if missing. `lng` overrides the current language for one
 *  call (the feedback thread renders its chrome in the BOT's chosen language, not the device locale). */
export function t(key, params, lng) {
  const L = (lng === 'en' || lng === 'nl') ? lng : currentLang;
  const hit = lookup(BUNDLES[L], key)
           ?? lookup(BUNDLES.en, key)
           ?? key;
  return interpolate(hit, params);
}

export const __test__ = { unwrapLeaves, lookup, BUNDLES };

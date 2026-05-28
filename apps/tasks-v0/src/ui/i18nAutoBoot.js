/**
 * tasks-v0 web — drop-in auto-bootstrap for the runtime locale loader.
 * Post-V0 follow-up (#272, 2026-05-27).
 *
 * Pages add a single side-effect import:
 *
 *   <script type="module" src="/lib/i18nAutoBoot.js"></script>
 *
 * On load: reads `?lng=<code>` from the URL (or `localStorage` under
 * `tasks-v0:lng`, default `en`), boots `/lib/i18nBootstrap.js`,
 * walks `document` to translate `data-i18n*` attributes, and writes
 * `<html lang>` for a11y.
 *
 * Persistence: a chosen language sticks to `localStorage` so the
 * next page-load uses it.  Set via `?lng=` then refresh.
 *
 * Future: a proper switcher widget in the nav.  For now `?lng=nl`
 * in the URL is the affordance.
 */

import { bootI18n, walkAndTranslate, setLang } from '/lib/i18nBootstrap.js';

const STORAGE_KEY = 'tasks-v0:lng';
const SUPPORTED   = ['en', 'nl'];

function _pickLang() {
  // 1. Explicit URL override.
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('lng');
    if (q && SUPPORTED.includes(q)) {
      try { localStorage.setItem(STORAGE_KEY, q); } catch { /* private mode etc. */ }
      return q;
    }
  } catch { /* SSR / non-browser */ }
  // 2. Persisted previous choice.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch { /* defensive */ }
  // 3. Default.
  return 'en';
}

(async () => {
  const lng = _pickLang();
  try {
    await bootI18n({ lng });
    walkAndTranslate(document);
    if (document?.documentElement) document.documentElement.lang = lng;
  } catch (err) {
    // Don't break the page if locale fetch fails — leave the
    // English fallback strings the HTML already shows.
    console.warn?.('[i18n] auto-boot failed; using hardcoded fallback:', err?.message ?? err);
  }
})();

// Export a tiny helper so pages CAN trigger a language switch
// imperatively (e.g. from a future header switcher).  Kept lean —
// pages that don't need it just ignore.
export async function switchLang(lng) {
  if (!SUPPORTED.includes(lng)) return;
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* defensive */ }
  await setLang(lng);
  walkAndTranslate(document);
  if (document?.documentElement) document.documentElement.lang = lng;
}

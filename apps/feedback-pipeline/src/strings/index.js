// Locale registry — one entry per language file. Callers do `getStrings(config.language)`
// and reference keys; they never hardcode prose. Adding a language = add a file + register
// it here (the project config's language.preferred selects it).

import nl from './nl.js';
import en from './en.js';

const LOCALES = { nl, en };
export const DEFAULT_LANG = 'nl';

/** Get the string table for a language, falling back to the default. */
export function getStrings(lang = DEFAULT_LANG) {
  return LOCALES[lang] || LOCALES[DEFAULT_LANG];
}

export { LOCALES };

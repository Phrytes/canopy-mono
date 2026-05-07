/**
 * skillPicker — pure helpers for the SkillPicker component.
 *
 * Lives outside the JSX file so vitest can import without needing a
 * JSX-in-`.js` transform.
 */

/**
 * Return the language-appropriate string from a `{nl, en, ...}`
 * locale-field. Falls back to en, then nl. Plain strings pass
 * through.
 *
 * @param {string|object|null} field
 * @param {string} lang
 * @returns {string}
 */
export function localiseField(field, lang) {
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object') return '';
  if (typeof field[lang] === 'string') return field[lang];
  if (typeof field.en === 'string') return field.en;
  if (typeof field.nl === 'string') return field.nl;
  return '';
}

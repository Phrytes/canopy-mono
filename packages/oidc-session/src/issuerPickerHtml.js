/**
 * `getIssuerPickerHtml` — server-rendered HTML fragment for the
 * Solid OIDC issuer picker. Phase 52.15.4 (2026-05-14).
 *
 * Apps embed the fragment into their sign-in template; client-side
 * JS reads the form's selected radio + (if `'custom'`) the custom URL
 * input, then POSTs to its sign-in endpoint.
 *
 * Renders semantic HTML — `<fieldset>` + `<legend>` + radio
 * `<label>`s. Apps style with their own CSS. The fragment carries no
 * inline styles, no scripts. Form names are scoped via `namePrefix`
 * so multiple pickers can coexist in one form.
 *
 * @param {object} [opts]
 * @param {string} [opts.selectedId]      — which radio is checked initially (default: DEFAULT_ISSUER_ID).
 * @param {boolean} [opts.customAllowed]  — whether to render the "Custom URL" option (default: true).
 * @param {string} [opts.namePrefix]      — prefix for form name attributes (default: ''; produces `issuer-choice` and `issuer-custom`).
 * @param {string} [opts.customUrl]       — pre-fill value for the custom URL input (default: '').
 * @param {string} [opts.legend]          — fieldset legend text (default: 'Pod provider').
 * @param {string} [opts.customLabel]     — label text on the custom row (default: 'Custom URL').
 * @param {string} [opts.customPlaceholder] — placeholder for the custom URL input.
 * @returns {string}
 */
import { KNOWN_ISSUERS, DEFAULT_ISSUER_ID } from './issuers.js';

const DEFAULT_PLACEHOLDER = 'https://my-pod.example/';

/**
 * Render the Solid OIDC issuer picker as a server-side HTML fragment: a `<fieldset>` of radio
 * options for the known issuers plus an optional custom-URL row. Semantic markup only — no inline
 * styles, no scripts; form names are scoped via `namePrefix` so multiple pickers can coexist.
 * All options are documented in the file-header JSDoc above.
 * @returns {string} the HTML fragment
 */
export function getIssuerPickerHtml({
  selectedId = DEFAULT_ISSUER_ID,
  customAllowed = true,
  namePrefix = '',
  customUrl = '',
  legend = 'Pod provider',
  customLabel = 'Custom URL',
  customPlaceholder = DEFAULT_PLACEHOLDER,
} = {}) {
  const choiceName = namePrefix ? `${namePrefix}-issuer-choice` : 'issuer-choice';
  const customName = namePrefix ? `${namePrefix}-issuer-custom` : 'issuer-custom';

  // The selectedId may be a known issuer id, the literal 'custom', or
  // anything else (treat as default selection — fall back to known).
  const isCustomSelected = customAllowed && selectedId === 'custom';
  const matchedKnown = KNOWN_ISSUERS.find(i => i.id === selectedId);
  const effectiveSelectedId = isCustomSelected
    ? 'custom'
    : (matchedKnown ? matchedKnown.id : DEFAULT_ISSUER_ID);

  let html = '';
  html += `<fieldset class="issuer-picker">\n`;
  html += `  <legend>${esc(legend)}</legend>\n`;

  for (const issuer of KNOWN_ISSUERS) {
    const checked = issuer.id === effectiveSelectedId ? ' checked' : '';
    // value carries the URL — the client-side JS reads it directly and
    // posts to the sign-in endpoint without an extra resolution step.
    html += `  <label class="issuer-picker__option">\n`;
    html += `    <input type="radio" name="${esc(choiceName)}" value="${esc(issuer.url)}"${checked} data-issuer-id="${esc(issuer.id)}">\n`;
    html += `    <span class="issuer-picker__label">${esc(issuer.label)}</span>\n`;
    html += `    <span class="issuer-picker__hint">${esc(stripScheme(issuer.url))}</span>\n`;
    html += `  </label>\n`;
  }

  if (customAllowed) {
    const checked = isCustomSelected ? ' checked' : '';
    html += `  <label class="issuer-picker__option issuer-picker__option--custom">\n`;
    html += `    <input type="radio" name="${esc(choiceName)}" value="custom"${checked} data-issuer-id="custom">\n`;
    html += `    <span class="issuer-picker__label">${esc(customLabel)}</span>\n`;
    html += `    <input type="url" name="${esc(customName)}" placeholder="${esc(customPlaceholder)}" value="${esc(customUrl)}" autocomplete="off">\n`;
    html += `  </label>\n`;
  }

  html += `</fieldset>\n`;
  return html;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripScheme(url) {
  return url.replace(/^https?:\/\//, '');
}

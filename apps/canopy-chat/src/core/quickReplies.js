/**
 * canopy-chat — quick-reply pill row (α.5a, audit #3).
 *
 * A `Reply` may carry a `quickReplies` array.  Each entry is a
 * `{label, slash}` pair the chat shell renders as a tappable pill
 * under the bubble text — clicking dispatches `slash` through the
 * exact same path Enter-submitted slashes use (no parser
 * duplication; see `web/main.js handleUserText` + mobile
 * `ChatScreen.submitInput`).
 *
 * Portable on purpose: the renderer (`renderer.js`) calls
 * `normalizeQuickReplies` so a vitest can exercise the shape
 * without touching the DOM or RN.
 *
 * Shape contract (intentionally narrow):
 *
 *   quickReplies?: Array<{ label: string, slash: string }>
 *
 *   - `slash` MUST start with '/'.  Anything else is dropped — the
 *     pill exists to dispatch a slash, not to inject free text.
 *   - `label` is optional; when missing/blank we fall back to the
 *     `circle.chat.quick_reply.fallback_label` locale (English
 *     "Reply" / Dutch "Antwoord").
 *   - Non-string, non-object entries are silently dropped (defensive
 *     pass-through; same posture as `followUps`).
 *
 * Returns `undefined` (not `[]`) when nothing usable comes in, so
 * the renderer can omit the field entirely — DOM / RN adapters then
 * skip rendering the pill row at all.
 */

/**
 * @typedef {object} QuickReply
 * @property {string} label  display label (`circle.chat.quick_reply.fallback_label` when blank)
 * @property {string} slash  full slash to dispatch, leading '/' included
 */

/**
 * @param {unknown}  input
 * @param {object}   [opts]
 * @param {(key: string) => string} [opts.t]
 *   Optional translator.  When omitted, blank labels fall back to
 *   the English literal "Reply" so this module stays usable in tests
 *   without a localisation runtime.
 * @returns {QuickReply[] | undefined}
 */
export function normalizeQuickReplies(input, opts = {}) {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const t = typeof opts.t === 'function' ? opts.t : null;
  const fallbackLabel = () => {
    if (!t) return 'Reply';
    const v = t('circle.chat.quick_reply.fallback_label');
    return typeof v === 'string' && v !== '' && v !== 'circle.chat.quick_reply.fallback_label'
      ? v
      : 'Reply';
  };

  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const slash = typeof raw.slash === 'string' ? raw.slash.trim() : '';
    if (!slash.startsWith('/')) continue;   // pill MUST dispatch a slash
    const rawLabel = typeof raw.label === 'string' ? raw.label.trim() : '';
    const label    = rawLabel !== '' ? rawLabel : fallbackLabel();
    out.push({ label, slash });
  }
  return out.length > 0 ? out : undefined;
}

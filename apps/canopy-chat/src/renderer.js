/**
 * canopy-chat — renderer.
 *
 * Takes a `Reply` envelope (from `dispatch.js`) + the merged catalog
 * and produces a platform-neutral `RenderedReply` data structure.
 * The DOM / RN adapter consumes this; v0.1 emits the data structure
 * so headless tests can verify rendering without a browser.
 *
 * v0.1 ships two reply shapes:
 *   - 'text'  — single message bubble.  Default for mutations.
 *   - 'list'  — list of items + per-item inline keyboard from
 *               `renderChat.inlineKeyboardFor()`.  Default for verb:'list'.
 *
 * Future phases add 'record' / 'mini-page' (v0.3), 'embed-card' /
 * 'notification' (v0.5), 'brief' (v0.7).
 *
 * Phase v0.1 sub-slice 1.8 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { renderChat } from '@canopy/app-manifest';

/**
 * @typedef {object} RenderedReply
 * @property {'text' | 'list' | 'error'} kind
 * @property {string}                     messageId
 * @property {string|null}                threadId
 * @property {'live'|'disabled'|'closed'} lifecycleState
 *   A2 hybrid (per choice A in DESIGN-canopy-chat-journeys.md):
 *   action menus default 'live' and flip 'disabled' on next user
 *   message; text bubbles never flip (n/a).  Record / mini-page
 *   shapes (v0.3) stay 'live' until explicit close.
 * @property {string}                     [text]
 *   Text for kind: 'text' | 'error'.
 * @property {Array<RenderedListItem>}    [items]
 *   Items for kind: 'list'.
 * @property {{code: string, message: string}} [error]
 *   Original error for kind: 'error'.
 */

/**
 * @typedef {object} RenderedListItem
 * @property {string} id
 * @property {string} label                rendered display text
 * @property {Array<{label: string, callbackData: string}>} buttons
 */

let _idSeq = 0;
function nextMessageId() {
  _idSeq += 1;
  return `m-${Date.now().toString(36)}-${_idSeq.toString(36)}`;
}

/**
 * Render a Reply into a RenderedReply.
 *
 * @param {import('./dispatch.js').Reply}                       reply
 * @param {object}                                              [opts]
 * @param {object}                                              [opts.appliesToItem]
 *   When set, the chat shell wants inline-keyboard buttons for this item;
 *   used by list-shape rendering.  Not user-facing.
 * @param {object<string, object>}                              [opts.manifestsByOrigin]
 *   Optional: map of appOrigin → manifest.  Required for list shape
 *   to compute per-item inline-keyboard via renderChat.inlineKeyboardFor.
 *   When absent, list items render with no buttons (still useful for
 *   bare display).
 * @param {string}                                              [opts.appOrigin]
 *   The dispatch's appOrigin; used to look up the right manifest in
 *   manifestsByOrigin.
 * @returns {RenderedReply}
 */
export function renderReply(reply, opts = {}) {
  if (!reply || typeof reply !== 'object') {
    throw new TypeError('renderReply: reply required');
  }

  const messageId = nextMessageId();
  const threadId  = reply.threadId ?? null;

  // Errors render as a text bubble with `kind: 'error'` so the chat
  // shell can style them distinctly (red bubble, retry affordance,
  // etc.).
  if (reply.error) {
    return {
      kind: 'error',
      messageId, threadId,
      lifecycleState: 'live',
      text:  formatErrorText(reply.error),
      error: reply.error,
    };
  }

  const shape = reply.shape ?? 'text';

  if (shape === 'list') {
    const items = renderListItems(reply.payload, opts);
    return {
      kind: 'list',
      messageId, threadId,
      lifecycleState: 'live',     // A2 hybrid — flips 'disabled' on next user msg
      items,
    };
  }

  // Default + text: render as a text bubble.
  return {
    kind: 'text',
    messageId, threadId,
    lifecycleState: 'live',
    text: formatText(reply.payload),
  };
}

/* ───── shape: text ───── */

/**
 * Convert an arbitrary skill payload to a single display string.
 * Conventions (in priority order):
 *
 *   1. payload.message (string)        — the canonical chat reply field
 *   2. payload.text    (string)        — alternative
 *   3. payload.ok === true             — "✓"
 *   4. payload.ok === false            — payload.error || "Failed"
 *   5. payload is a primitive string   — verbatim
 *   6. payload is a primitive number/boolean — String(payload)
 *   7. fallback                        — JSON.stringify (visible; nudges apps to declare a field)
 *
 * @param {*} payload
 * @returns {string}
 */
export function formatText(payload) {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string')               return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload);
  }
  if (typeof payload === 'object') {
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.text === 'string')    return payload.text;
    if (payload.ok === true)                 return '✓';
    if (payload.ok === false) {
      const err = payload.error;
      if (typeof err === 'string')       return err;
      if (err && typeof err === 'object' && typeof err.message === 'string') {
        return err.message;
      }
      return 'Failed';
    }
  }
  // Last resort — surface the raw shape so the developer notices.
  try { return JSON.stringify(payload); }
  catch { return String(payload); }
}

function formatErrorText({ code, message }) {
  if (typeof message === 'string' && message !== '') return message;
  if (typeof code    === 'string' && code    !== '') return code;
  return 'Error';
}

/* ───── shape: list ───── */

/**
 * Convert a payload into list items.  Convention: payload.items is
 * the source array.  Each item is normalised + (optionally) decorated
 * with an inline keyboard from `renderChat.inlineKeyboardFor`.
 *
 * @param {*} payload
 * @param {object} opts
 * @returns {RenderedListItem[]}
 */
function renderListItems(payload, opts) {
  const raw = Array.isArray(payload?.items) ? payload.items
            : Array.isArray(payload)         ? payload    // tolerant: bare array
            : [];

  const inlineKeyboardFor = pickInlineKeyboardFor(opts);

  return raw.map((item, i) => {
    const id    = String(item?.id ?? item?._id ?? `i-${i}`);
    const label = String(itemLabel(item) ?? id);
    const buttons = inlineKeyboardFor
      ? inlineKeyboardFor({ id, ...(typeof item === 'object' ? item : {}) })
      : [];
    return { id, label, buttons };
  });
}

/**
 * Item display field (in priority order).  Apps following the convention
 * supply at least one of these.
 *
 * @param {*} item
 * @returns {string | undefined}
 */
function itemLabel(item) {
  if (item === null || item === undefined) return undefined;
  if (typeof item === 'string') return item;
  if (typeof item !== 'object') return String(item);
  return item.label
    ?? item.title
    ?? item.text
    ?? item.name
    ?? item.description
    ?? undefined;
}

/**
 * Resolve a per-item inline-keyboard function from the manifest of
 * the dispatch's appOrigin.  Returns undefined if no manifest was
 * provided (caller chose to skip per-item buttons).
 *
 * @param {object} opts
 * @returns {Function | undefined}
 */
function pickInlineKeyboardFor(opts) {
  const { manifestsByOrigin, appOrigin } = opts ?? {};
  if (!manifestsByOrigin || !appOrigin) return undefined;
  const manifest = manifestsByOrigin[appOrigin];
  if (!manifest) return undefined;
  // Build a renderChat projection with a no-op skillRegistry — we only
  // want inlineKeyboardFor, not toolHandlers.
  const stub = {};
  for (const op of manifest.operations ?? []) {
    stub[op.id] = async () => ({ replies: [], stateUpdates: [] });
  }
  const proj = renderChat(manifest, {
    skillRegistry: stub,
    toSkillCtx:    (c) => c,
  });
  return proj.inlineKeyboardFor;
}

/* ───── test seam ───── */

/**
 * Reset the messageId counter for deterministic snapshot tests.
 * Module-private; exported for tests only.
 *
 * @internal
 */
export function __resetMessageIdSeq() { _idSeq = 0; }

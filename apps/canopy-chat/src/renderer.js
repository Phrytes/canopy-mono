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

import { formatSyncHints, formatLastSync } from './syncHints.js';
import { QR_URI_PREFIXES }                 from './core/qrSchemes.js';
import { normalizeQuickReplies }           from './core/quickReplies.js';

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
 * Default t() implementation used when no localiser is supplied —
 * returns English fallbacks for the renderer's own user-facing
 * strings.  The chat shell normally passes a real `t` (from
 * `./localisation.js`) via opts; this fallback keeps the renderer
 * usable in tests + environments where localisation hasn't been
 * initialised yet.
 *
 * @param {string} key
 * @returns {string}
 */
const DEFAULT_T = (key) => {
  switch (key) {
    case 'common.ok':     return '✓';
    case 'common.failed': return 'Failed';
    case 'common.error':  return 'Error';
    default:              return key;
  }
};

/**
 * Render a Reply into a RenderedReply.
 *
 * @param {import('./dispatch.js').Reply}                       reply
 * @param {object}                                              [opts]
 * @param {object<string, object>}                              [opts.manifestsByOrigin]
 *   Optional: map of appOrigin → manifest.  Required for list shape
 *   to compute per-item inline-keyboard via renderChat.inlineKeyboardFor.
 *   When absent, list items render with no buttons (still useful for
 *   bare display).
 * @param {string}                                              [opts.appOrigin]
 *   The dispatch's appOrigin; used to look up the right manifest in
 *   manifestsByOrigin.
 * @param {(key: string, params?: object) => string}            [opts.t]
 *   Translator function (typically from `./localisation.js`).  Falls
 *   back to English literals for the renderer's own strings when
 *   absent.
 * @returns {RenderedReply}
 */
export function renderReply(reply, opts = {}) {
  if (!reply || typeof reply !== 'object') {
    throw new TypeError('renderReply: reply required');
  }

  const t         = typeof opts.t === 'function' ? opts.t : DEFAULT_T;
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
      text:  formatErrorText(reply.error, t),
      error: reply.error,
    };
  }

  const shape = reply.shape ?? 'text';

  if (shape === 'list') {
    const items = renderListItems(reply.payload, opts, t);
    return {
      kind: 'list',
      messageId, threadId,
      lifecycleState: 'live',     // A2 hybrid — flips 'disabled' on next user msg
      items,
      // v0.6 — list-level _sync from the reply itself (vs per-row
      // _lastSync extracted inside renderListItems).
      syncHint: formatSyncHints(reply.payload?._sync, t),
    };
  }

  if (shape === 'record' || shape === 'mini-page') {
    return {
      kind: shape,
      messageId, threadId,
      lifecycleState: 'live',     // A2 hybrid — record/mini-page stay live until Close
      title:  inferRecordTitle(reply.payload),
      fields: extractRecordFields(reply.payload),
      // Preserve the original payload for app-specific renderers that
      // want richer access; the DOM adapter falls back to fields[] for
      // generic display.
      payload: reply.payload,
    };
  }

  if (shape === 'find') {
    // v0.7.5 — Q33 search aggregator output.  Payload is a FindReply
    // (query, groups[], generatedAt, extensiveAvailable).
    return {
      kind: 'find',
      messageId, threadId,
      lifecycleState: 'live',
      query:              reply.payload?.query              ?? '',
      groups:             Array.isArray(reply.payload?.groups) ? reply.payload.groups : [],
      generatedAt:        reply.payload?.generatedAt        ?? Date.now(),
      extensiveAvailable: !!reply.payload?.extensiveAvailable,
    };
  }

  if (shape === 'brief') {
    // v0.7 — Q30 aggregator output.  Payload is a BriefReply
    // (sections[], generatedAt, cacheKey, optional emptyMessage).
    // DOM adapter renders.
    return {
      kind: 'brief',
      messageId, threadId,
      lifecycleState: 'live',   // A2 hybrid — brief stays live until close
      sections:     Array.isArray(reply.payload?.sections) ? reply.payload.sections : [],
      generatedAt:  reply.payload?.generatedAt ?? Date.now(),
      cacheKey:     reply.payload?.cacheKey,
      // A3 follow-up: brief.js sets this when every section was
      // filtered out by isEmpty — renderer can show the hint.
      emptyMessage: typeof reply.payload?.emptyMessage === 'string'
        ? reply.payload.emptyMessage
        : undefined,
    };
  }

  if (shape === 'embed-card') {
    // v0.5 — embedded item card (J7).  The reply.payload IS the embed
    // envelope; the DOM adapter consumes it.
    return {
      kind:           'embed-card',
      messageId, threadId,
      lifecycleState: 'live',   // A2 hybrid — embed cards stay live until close
      embed:          reply.payload,
    };
  }

  // Default + text: render as a text bubble.
  return {
    kind: 'text',
    messageId, threadId,
    lifecycleState: 'live',
    text: formatText(reply.payload, t),
    // v0.4 — when caller pre-computes follow-up suggestions (via
    // `collectFollowUps`), they ride along on the rendered reply.
    // DOM adapter renders them as inline buttons below the text.
    followUps: Array.isArray(reply.followUps) ? reply.followUps : undefined,
    // α.5a (audit #3) — bot replies may carry inline-keuze quick-reply
    // pills: `[{label, slash}, ...]`.  Pure pass-through; DOM + RN
    // adapters render the pill row + tapping dispatches the slash
    // through the same path Enter-submitted text uses.
    quickReplies: normalizeQuickReplies(reply.quickReplies, { t }),
    // v0.6 — sync-hint suffix from the reply's _sync envelope.
    // Empty string when 'central' or absent; DOM adapter omits the
    // sub-line entirely in that case.
    syncHint: formatSyncHints(reply.payload?._sync, t),
  };
}

/* ───── shape: record / mini-page ───── */

/**
 * Pull a human-readable title from a record payload.  Priority:
 *   1. payload.title
 *   2. payload.name
 *   3. payload.label
 *   4. fallback: undefined (DOM adapter renders without a title bar)
 */
function inferRecordTitle(payload) {
  if (payload === null || typeof payload !== 'object') return undefined;
  if (typeof payload.title === 'string') return payload.title;
  if (typeof payload.name  === 'string') return payload.name;
  if (typeof payload.label === 'string') return payload.label;
  return undefined;
}

/**
 * Convert a record-shape payload into platform-neutral field rows.
 * Skips meta fields (`title`, `name`, `label`, `id`, `_*`) since
 * those are typically rendered separately (title bar) or are
 * substrate plumbing (`_sync`, `_lastSync`).
 *
 * @param {*} payload
 * @returns {Array<{name: string, value: *, kind: string}>}
 */
function extractRecordFields(payload) {
  if (payload === null || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return [];  // arrays render via 'list' shape, not record
  const out = [];
  for (const [name, value] of Object.entries(payload)) {
    if (name === 'title' || name === 'name' || name === 'label' || name === 'id') continue;
    if (name.startsWith('_')) continue;   // skip _sync, _lastSync, _internal etc.
    out.push({
      name,
      value,
      kind: classifyFieldKind(value),
    });
  }
  return out;
}

// QR_URI_PREFIXES lifted to ./core/qrSchemes.js so the mobile chat-shell
// can share the registry (2026-05-27).

function classifyFieldKind(v) {
  if (typeof v === 'string') {
    if (QR_URI_PREFIXES.some((p) => v.startsWith(p))) return 'qr';
    return 'string';
  }
  if (typeof v === 'number')  return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) {
    // #194 (B9, 2026-05-23) — detect "refs" arrays: every element is
    // an object with `type` + `ref` (or `id`).  Pattern used by folio
    // note frontmatter `embeds: [{type: 'task', ref: 't-1', label}]`
    // and any other "see also" reference list.  Renderer chips these.
    if (v.length > 0 && v.every((e) =>
      e && typeof e === 'object' &&
      typeof e.type === 'string' &&
      (typeof e.ref === 'string' || typeof e.id === 'string')
    )) return 'refs';
    return 'list';
  }
  if (v && typeof v === 'object') {
    // #195 (B7) — detect availability-grid shape: object whose keys
    // are numeric day-indexes (0-6) mapping to objects with 'AM'/'PM'
    // string-state values.  Renderer dispatches to renderGridField.
    const keys = Object.keys(v);
    const looksLikeGrid = keys.length > 0 && keys.every((k) => /^[0-6]$/.test(k))
      && keys.every((k) => v[k] && typeof v[k] === 'object'
        && ('AM' in v[k] || 'PM' in v[k]));
    if (looksLikeGrid) return 'grid';
    return 'object';
  }
  return 'unknown';
}

/* ───── shape: text ───── */

/**
 * Convert an arbitrary skill payload to a single display string.
 * Conventions (in priority order):
 *
 *   1. payload.message (string)        — the canonical chat reply field
 *   2. payload.text    (string)        — alternative
 *   3. payload.ok === true             — t('common.ok') (default "✓")
 *   4. payload.ok === false            — payload.error || t('common.failed')
 *   5. payload is a primitive string   — verbatim
 *   6. payload is a primitive number/boolean — String(payload)
 *   7. fallback                        — JSON.stringify (visible; nudges apps to declare a field)
 *
 * @param {*} payload
 * @param {(key: string, params?: object) => string} [t]
 * @returns {string}
 */
export function formatText(payload, t = DEFAULT_T) {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string')               return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload);
  }
  if (typeof payload === 'object') {
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.text === 'string')    return payload.text;
    if (payload.ok === true)                 return t('common.ok');
    if (payload.ok === false) {
      const err = payload.error;
      if (typeof err === 'string')       return err;
      if (err && typeof err === 'object' && typeof err.message === 'string') {
        return err.message;
      }
      return t('common.failed');
    }
    // A5/A6 follow-up (2026-05-27 user real-device test) — many
    // mutating skills return `{itemId, queued}` etc with no
    // friendly `message`.  Synthesise something readable from the
    // obvious fields before falling back to JSON dump.
    const id    = payload.itemId ?? payload.id ?? payload.requestId;
    const label = payload.label  ?? payload.text ?? payload.title;
    if (typeof id === 'string' && id !== '') {
      const queuedHint = payload.queued === true ? ' (queued)' : '';
      return label
        ? `✓ ${label}${queuedHint}`
        : `✓ Done (${id})${queuedHint}`;
    }
  }
  // Last resort — surface the raw shape so the developer notices.
  try { return JSON.stringify(payload); }
  catch { return String(payload); }
}

function formatErrorText({ code, message }, t = DEFAULT_T) {
  if (typeof message === 'string' && message !== '') return message;
  if (typeof code    === 'string' && code    !== '') return code;
  return t('common.error');
}

/* ───── shape: list ───── */

/**
 * Convert a payload into list items.  Convention: payload.items is
 * the source array.  Each item is normalised + (optionally) decorated
 * with an inline keyboard from `renderChat.inlineKeyboardFor`.
 *
 * v0.6 — per-row `_lastSync` annotation (epoch ms) renders as a
 * staleness label (`'2h ago'`).  When the row also has a top-level
 * `_sync` style hint (rare), prefer that.
 *
 * @param {*} payload
 * @param {object} opts
 * @param {Function} [t]
 * @returns {RenderedListItem[]}
 */
function renderListItems(payload, opts, t) {
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
    // v0.6 — per-row staleness label from item._lastSync.
    const staleHint = formatLastSync(item?._lastSync, t);
    // Bundle F P4-followup-1 (#266) — surface item.embed so a
    // [Download] tap on a folio file-card can reach the inline
    // snapshot bytes (mobile's saveBase64File path).  Pure pass-
    // through; renderer doesn't interpret the embed shape.
    const embed = (item && typeof item === 'object' && item.embed) || undefined;
    const out = { id, label, buttons };
    if (staleHint) out.staleHint = staleHint;
    if (embed)     out.embed     = embed;
    // 2026-05-27 — contact rows carry the peer's NKN address as
    // `peerAddr` so the [DM] button can target it directly (see
    // realAgent.js listContacts mapper).  Pure pass-through.
    if (item && typeof item === 'object' && typeof item.peerAddr === 'string' && item.peerAddr) {
      out.peerAddr = item.peerAddr;
    }
    return out;
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

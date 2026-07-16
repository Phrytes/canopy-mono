/**
 * @onderling/chat-nav — returnTo query-param helpers.
 *
 * Per B.1 nav protocol: chat-link URLs carry `?returnTo=<threadId>`.
 * Side-panel pages read this on mount.
 */

const PARAM = 'returnTo';

/**
 * Read the returnTo param from the given URL (defaults to
 * `globalThis.location`).
 *
 * @param {string | URL | Location} [source]  defaults to the browser's location
 * @returns {string | null}                    threadId, or null when absent
 */
export function getReturnTo(source) {
  const url = resolveUrl(source);
  if (!url) return null;
  const value = url.searchParams.get(PARAM);
  return value && value.trim() !== '' ? value : null;
}

/**
 * React-flavoured alias.  Returns `{ threadId, chatHref }` where
 * `chatHref` is the URL the floating button should navigate to, OR
 * null when the page wasn't opened from chat.
 *
 * (`use*` naming matches downstream React consumers — but this is
 * pure JS; no hook dependency.  Consumers may wrap it in their
 * framework's hook semantics.)
 *
 * @param {object}   [opts]
 * @param {string}   [opts.chatPath='/']   relative path to the chat page
 * @param {string|URL|Location} [opts.location]   defaults to globalThis.location
 * @returns {{threadId: string, chatHref: string} | null}
 */
export function useReturnToChat(opts = {}) {
  const threadId = getReturnTo(opts.location);
  if (!threadId) return null;
  const chatPath = opts.chatPath ?? '/';
  return {
    threadId,
    chatHref: buildChatUrl(chatPath, threadId),
  };
}

/**
 * Build a chat-shell URL that opens a specific thread on load.
 *
 * @param {string} chatPath     e.g. '/' or '/chat'
 * @param {string} threadId
 * @returns {string}            e.g. '/chat?focus=<threadId>'
 */
export function buildChatUrl(chatPath, threadId) {
  const safeId = encodeURIComponent(String(threadId ?? ''));
  const sep    = chatPath.includes('?') ? '&' : '?';
  return `${chatPath}${sep}focus=${safeId}`;
}

/* ─── internals ────────────────────────────────────────── */

function resolveUrl(source) {
  if (source && typeof source === 'object' && 'searchParams' in source && 'pathname' in source) {
    return source;   // URL or URL-like
  }
  if (source && typeof source === 'object' && 'search' in source) {
    // happy-dom / browser Location object.  Build a URL via its href.
    try { return new URL(source.href); }
    catch { return null; }
  }
  if (typeof source === 'string') {
    try { return new URL(source, 'http://localhost'); }
    catch { return null; }
  }
  if (typeof globalThis !== 'undefined' && globalThis.location) {
    try { return new URL(globalThis.location.href); }
    catch { return null; }
  }
  return null;
}
